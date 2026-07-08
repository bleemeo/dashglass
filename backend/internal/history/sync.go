package history

import (
	"context"
	"fmt"
	"os"
	"strings"
	"sync"
	"time"
)

// networkTimeout bounds fetch/push/ls-remote calls.
const networkTimeout = 60 * time.Second

// DefaultSyncInterval is the pull-loop period when none is configured.
const DefaultSyncInterval = 60 * time.Second

// Remote is a git remote synced by the Syncer. Credentials are HTTPS
// username + token (PAT), handed to git through the askpass mechanism —
// never on the command line, never written to the repository config.
type Remote struct {
	URL      string
	Username string
	Password string
}

// SyncStatus is one snapshot of the sync loop, for the admin UI.
type SyncStatus struct {
	Enabled bool `json:"enabled"`
	// Branch is the currently checked-out branch being synced.
	Branch string `json:"branch,omitempty"`
	// Ahead/Behind count local-only and remote-only commits after the
	// last cycle (0/0 when in sync).
	Ahead  int `json:"ahead"`
	Behind int `json:"behind"`
	// LastSync is the end of the last successful cycle (RFC3339, empty
	// before the first one).
	LastSync string `json:"lastSync,omitempty"`
	// LastError is the failure of the most recent cycle, cleared on the
	// next success.
	LastError string `json:"lastError,omitempty"`
}

// Syncer keeps the local repository and a remote converged: it pulls
// fast-forward changes on a timer and pushes local commits (woken by
// commit-on-save). Cycles hold the service write lock, so saves and
// syncs never interleave.
type Syncer struct {
	service *Service

	mu       sync.Mutex // guards remote, interval, status
	remote   *Remote
	interval time.Duration
	status   SyncStatus

	syncMu sync.Mutex    // single-flight for cycles
	wake   chan struct{} // buffered; NotifyCommit/SetRemote poke the loop
}

// NewSyncer creates a syncer over the repository; remote may be nil
// (disabled until SetRemote).
func NewSyncer(service *Service, remote *Remote, interval time.Duration) *Syncer {
	if interval <= 0 {
		interval = DefaultSyncInterval
	}
	return &Syncer{
		service:  service,
		remote:   remote,
		interval: interval,
		wake:     make(chan struct{}, 1),
	}
}

// SetRemote reconfigures the remote at runtime (nil disables) and
// triggers an immediate cycle.
func (y *Syncer) SetRemote(remote *Remote, interval time.Duration) {
	y.mu.Lock()
	y.remote = remote
	if interval > 0 {
		y.interval = interval
	}
	if remote == nil {
		y.status = SyncStatus{}
	}
	y.mu.Unlock()
	y.poke()
}

// Remote returns the current remote (nil = disabled).
func (y *Syncer) Remote() *Remote {
	y.mu.Lock()
	defer y.mu.Unlock()
	return y.remote
}

// Status returns the latest snapshot.
func (y *Syncer) Status() SyncStatus {
	y.mu.Lock()
	defer y.mu.Unlock()
	return y.status
}

// Interval returns the current pull-loop period.
func (y *Syncer) Interval() time.Duration {
	y.mu.Lock()
	defer y.mu.Unlock()
	return y.interval
}

// NotifyCommit asks for a near-immediate push (called after
// commit-on-save lands a local commit).
func (y *Syncer) NotifyCommit() {
	y.poke()
}

func (y *Syncer) poke() {
	select {
	case y.wake <- struct{}{}:
	default:
	}
}

// Run drives the loop until ctx is canceled.
func (y *Syncer) Run(ctx context.Context) {
	for {
		y.mu.Lock()
		interval := y.interval
		y.mu.Unlock()
		select {
		case <-ctx.Done():
			return
		case <-y.wake:
		case <-time.After(interval):
		}
		if y.Remote() != nil {
			y.SyncNow()
		}
	}
}

// askpassEnv passes remote credentials to git: GIT_ASKPASS points back
// at the polaris binary (the "askpass" subcommand), which answers the
// username/password prompts from these variables. Nothing credential-
// shaped appears on any command line or in the repository config.
func askpassEnv(remote *Remote) []string {
	if remote.Username == "" && remote.Password == "" {
		return nil
	}
	exe, err := os.Executable()
	if err != nil {
		return nil
	}
	return []string{
		"GIT_ASKPASS=" + exe,
		"POLARIS_ASKPASS_USERNAME=" + remote.Username,
		"POLARIS_ASKPASS_PASSWORD=" + remote.Password,
	}
}

// TestRemote checks that the remote answers (git ls-remote) with the
// given credentials, without touching the local repository.
func (s *Service) TestRemote(remote *Remote) error {
	_, err := s.gitEnv(askpassEnv(remote), networkTimeout,
		"ls-remote", "--heads", "--", remote.URL)
	return err
}

// SyncNow runs one cycle: fetch, fast-forward behind-only changes, push
// ahead-only commits, rebase-then-push a diverged branch (aborting to a
// surfaced error on conflicts). Returns the resulting status.
func (y *Syncer) SyncNow() SyncStatus {
	y.syncMu.Lock()
	defer y.syncMu.Unlock()
	remote := y.Remote()
	if remote == nil {
		return y.Status()
	}

	status, err := y.cycle(remote)
	status.Enabled = true
	y.mu.Lock()
	if err != nil {
		// Keep the last good sync time; record what went wrong.
		status.LastSync = y.status.LastSync
		status.LastError = err.Error()
	} else {
		status.LastSync = time.Now().UTC().Format(time.RFC3339)
	}
	y.status = status
	y.mu.Unlock()
	return y.Status()
}

// cycle does the actual git work under the service write lock.
func (y *Syncer) cycle(remote *Remote) (SyncStatus, error) {
	s := y.service
	s.mu.Lock()
	defer s.mu.Unlock()
	var status SyncStatus

	branch, err := s.git("rev-parse", "--abbrev-ref", "HEAD")
	if err != nil {
		return status, err
	}
	status.Branch = strings.TrimSpace(branch)
	if status.Branch == "HEAD" {
		return status, fmt.Errorf("detached HEAD: check out a branch to sync")
	}

	env := askpassEnv(remote)
	push := func() error {
		_, err := s.gitEnv(env, networkTimeout,
			"push", "--", remote.URL, "HEAD:refs/heads/"+status.Branch)
		return err
	}

	// Fetch the remote branch; a missing ref (fresh empty remote) just
	// means everything local is ahead.
	remoteExists := true
	if _, err := s.gitEnv(env, networkTimeout,
		"fetch", "--", remote.URL, status.Branch); err != nil {
		if !strings.Contains(err.Error(), "couldn't find remote ref") {
			return status, err
		}
		remoteExists = false
	}

	if !remoteExists {
		// Nothing to compare against: publish the branch if it has any
		// commits at all.
		if _, err := s.git("rev-parse", "--verify", "HEAD"); err == nil {
			if err := push(); err != nil {
				return status, err
			}
		}
		return status, nil
	}

	count := func(spec string) (int, error) {
		out, err := s.git("rev-list", "--count", spec)
		if err != nil {
			return 0, err
		}
		return atoi(strings.TrimSpace(out)), nil
	}
	if status.Ahead, err = count("FETCH_HEAD..HEAD"); err != nil {
		return status, err
	}
	if status.Behind, err = count("HEAD..FETCH_HEAD"); err != nil {
		return status, err
	}

	switch {
	case status.Behind > 0 && status.Ahead == 0:
		if _, err := s.git("merge", "--ff-only", "FETCH_HEAD"); err != nil {
			return status, err
		}
	case status.Ahead > 0 && status.Behind == 0:
		if err := push(); err != nil {
			return status, err
		}
	case status.Ahead > 0 && status.Behind > 0:
		// Diverged: replay our commits on top of the remote, then push.
		// A conflicting replay is aborted and surfaced — never resolved
		// silently.
		if _, err := s.git("rebase", "FETCH_HEAD"); err != nil {
			s.git("rebase", "--abort")
			return status, fmt.Errorf(
				"local and remote histories diverged and conflict; resolve manually in the repository")
		}
		if err := push(); err != nil {
			return status, err
		}
	}
	status.Ahead, status.Behind = 0, 0
	return status, nil
}

func atoi(raw string) int {
	value := 0
	for _, digit := range raw {
		if digit < '0' || digit > '9' {
			return 0
		}
		value = value*10 + int(digit-'0')
	}
	return value
}
