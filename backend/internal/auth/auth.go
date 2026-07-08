// Package auth implements the built-in authentication of DESIGN.md §7.4:
// local users with three fixed roles, signed-cookie sessions and the
// server-managed auth.yaml state file.
package auth

import (
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"

	"github.com/goccy/go-yaml"
)

// Role is one of the three fixed roles; ranks compare privileges.
type Role string

const (
	RoleViewer Role = "viewer"
	RoleEditor Role = "editor"
	RoleAdmin  Role = "admin"
)

var roleRank = map[Role]int{RoleViewer: 1, RoleEditor: 2, RoleAdmin: 3}

// ParseRole validates a role string.
func ParseRole(raw string) (Role, error) {
	role := Role(raw)
	if _, ok := roleRank[role]; !ok {
		return "", fmt.Errorf("invalid role %q (viewer, editor or admin)", raw)
	}
	return role, nil
}

// Allows reports whether a user with `role` may act as `required`.
func (role Role) Allows(required Role) bool {
	return roleRank[role] >= roleRank[required]
}

// User is a local account in auth.yaml.
type User struct {
	Username     string `yaml:"username" json:"username"`
	PasswordHash string `yaml:"password_hash" json:"-"`
	Role         Role   `yaml:"role" json:"role"`
	// SessionVersion invalidates outstanding cookies when bumped
	// (password/role change, deletion → stateless revocation).
	SessionVersion int `yaml:"session_version" json:"-"`
}

type fileContent struct {
	SessionSecret string `yaml:"session_secret"`
	Users         []User `yaml:"users"`
}

// Store owns auth.yaml: server-managed, written atomically, never
// hand-edited (DESIGN.md §7.4).
type Store struct {
	mu     sync.RWMutex
	path   string
	state  fileContent
	secret []byte // decoded session secret, cached after first use
}

// ErrNotFound is returned for unknown usernames.
var ErrNotFound = errors.New("user not found")

// ErrLastAdmin guards against locking everyone out.
var ErrLastAdmin = errors.New("cannot remove or demote the last admin")

// NewStore loads (or initializes) the auth state file. The session secret
// is generated on first use and persisted only once users exist.
func NewStore(path string) (*Store, error) {
	store := &Store{path: path}
	content, err := os.ReadFile(path)
	if errors.Is(err, os.ErrNotExist) {
		return store, nil
	}
	if err != nil {
		return nil, fmt.Errorf("reading auth state: %w", err)
	}
	if err := yaml.Unmarshal(content, &store.state); err != nil {
		return nil, fmt.Errorf("parsing %s: %w", path, err)
	}
	return store, nil
}

// Enabled reports whether authentication is active (any user exists).
func (s *Store) Enabled() bool {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return len(s.state.Users) > 0
}

// SessionSecret returns the HMAC secret, generating it on first call.
// Called on every authenticated request, so the common path is a cheap
// read lock over the cached decoded secret.
func (s *Store) SessionSecret() ([]byte, error) {
	s.mu.RLock()
	if s.secret != nil {
		defer s.mu.RUnlock()
		return s.secret, nil
	}
	s.mu.RUnlock()

	s.mu.Lock()
	defer s.mu.Unlock()
	if s.secret != nil { // another goroutine won the race
		return s.secret, nil
	}
	if s.state.SessionSecret == "" {
		raw := make([]byte, 32)
		if _, err := rand.Read(raw); err != nil {
			return nil, err
		}
		s.state.SessionSecret = hex.EncodeToString(raw)
		if len(s.state.Users) > 0 {
			if err := s.saveLocked(); err != nil {
				return nil, err
			}
		}
	}
	decoded, err := hex.DecodeString(s.state.SessionSecret)
	if err != nil {
		return nil, err
	}
	s.secret = decoded
	return s.secret, nil
}

// EnsureSecret generates and persists the session secret if absent. Local
// users persist it lazily, but an OIDC-only deployment has no users, so
// call this at startup to keep sessions valid across restarts.
func (s *Store) EnsureSecret() error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.state.SessionSecret != "" {
		return nil
	}
	raw := make([]byte, 32)
	if _, err := rand.Read(raw); err != nil {
		return err
	}
	s.state.SessionSecret = hex.EncodeToString(raw)
	decoded, err := hex.DecodeString(s.state.SessionSecret)
	if err != nil {
		return err
	}
	s.secret = decoded
	return s.saveLocked()
}

// Users lists the local accounts, sorted by name.
func (s *Store) Users() []User {
	s.mu.RLock()
	defer s.mu.RUnlock()
	users := make([]User, len(s.state.Users))
	copy(users, s.state.Users)
	sort.Slice(users, func(i, j int) bool { return users[i].Username < users[j].Username })
	return users
}

// Get returns a user by name.
func (s *Store) Get(username string) (User, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	for _, user := range s.state.Users {
		if user.Username == username {
			return user, nil
		}
	}
	return User{}, ErrNotFound
}

func validUsername(username string) error {
	if username == "" || len(username) > 64 ||
		strings.ContainsAny(username, " \t\n/\\") {
		return fmt.Errorf("invalid username %q", username)
	}
	return nil
}

// Create adds a local user with a freshly hashed password.
func (s *Store) Create(username, password string, role Role) error {
	if err := validUsername(username); err != nil {
		return err
	}
	if err := checkPassword(password); err != nil {
		return err
	}
	hash, err := hashPassword(password)
	if err != nil {
		return err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	for _, user := range s.state.Users {
		if user.Username == username {
			return fmt.Errorf("user %q already exists", username)
		}
	}
	s.state.Users = append(s.state.Users, User{
		Username:     username,
		PasswordHash: hash,
		Role:         role,
		SessionVersion: 1,
	})
	return s.saveLocked()
}

// Update changes the role and/or password; both bump the session version.
func (s *Store) Update(username string, role *Role, password *string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	index := -1
	for i, user := range s.state.Users {
		if user.Username == username {
			index = i
			break
		}
	}
	if index == -1 {
		return ErrNotFound
	}
	user := &s.state.Users[index]
	if role != nil && *role != RoleAdmin && user.Role == RoleAdmin && s.adminCountLocked() == 1 {
		return ErrLastAdmin
	}
	if role != nil {
		user.Role = *role
	}
	if password != nil {
		if err := checkPassword(*password); err != nil {
			return err
		}
		hash, err := hashPassword(*password)
		if err != nil {
			return err
		}
		user.PasswordHash = hash
	}
	user.SessionVersion++
	return s.saveLocked()
}

// Delete removes a user; the last admin is protected.
func (s *Store) Delete(username string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	for i, user := range s.state.Users {
		if user.Username != username {
			continue
		}
		if user.Role == RoleAdmin && s.adminCountLocked() == 1 {
			return ErrLastAdmin
		}
		s.state.Users = append(s.state.Users[:i], s.state.Users[i+1:]...)
		return s.saveLocked()
	}
	return ErrNotFound
}

// VerifyPassword checks credentials and returns the user.
func (s *Store) VerifyPassword(username, password string) (User, error) {
	user, err := s.Get(username)
	if err != nil {
		// Burn comparable time so unknown users are indistinguishable.
		verifyPassword(password, dummyHash)
		return User{}, ErrNotFound
	}
	if !verifyPassword(password, user.PasswordHash) {
		return User{}, errors.New("invalid credentials")
	}
	return user, nil
}

func (s *Store) adminCountLocked() int {
	count := 0
	for _, user := range s.state.Users {
		if user.Role == RoleAdmin {
			count++
		}
	}
	return count
}

func (s *Store) saveLocked() error {
	content, err := yaml.Marshal(s.state)
	if err != nil {
		return err
	}
	header := "# Managed by Dashglass — do not edit by hand (see DESIGN.md §7.4).\n"
	temp, err := os.CreateTemp(filepath.Dir(s.path), ".auth-*.tmp")
	if err != nil {
		return err
	}
	defer os.Remove(temp.Name())
	if _, err := temp.Write(append([]byte(header), content...)); err != nil {
		temp.Close()
		return err
	}
	if err := temp.Close(); err != nil {
		return err
	}
	if err := os.Chmod(temp.Name(), 0o600); err != nil {
		return err
	}
	return os.Rename(temp.Name(), s.path)
}

func checkPassword(password string) error {
	if len(password) < 8 {
		return errors.New("password must be at least 8 characters")
	}
	return nil
}
