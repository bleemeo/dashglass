package auth

import (
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func newTestStore(t *testing.T) *Store {
	t.Helper()
	store, err := NewStore(filepath.Join(t.TempDir(), "auth.yaml"))
	if err != nil {
		t.Fatal(err)
	}
	return store
}

func TestUserLifecycle(t *testing.T) {
	store := newTestStore(t)
	if store.Enabled() {
		t.Fatal("fresh store should be disabled")
	}

	if err := store.Create("lionel", "secret-password", RoleAdmin); err != nil {
		t.Fatalf("Create: %v", err)
	}
	if !store.Enabled() {
		t.Fatal("store with a user should be enabled")
	}

	if _, err := store.VerifyPassword("lionel", "secret-password"); err != nil {
		t.Fatalf("VerifyPassword: %v", err)
	}
	if _, err := store.VerifyPassword("lionel", "wrong"); err == nil {
		t.Fatal("wrong password should fail")
	}
	if _, err := store.VerifyPassword("ghost", "whatever"); !errors.Is(err, ErrNotFound) {
		t.Fatalf("unknown user error = %v", err)
	}

	// State survives a reload from disk, with restrictive permissions.
	reloaded, err := NewStore(store.path)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := reloaded.VerifyPassword("lionel", "secret-password"); err != nil {
		t.Fatalf("VerifyPassword after reload: %v", err)
	}
	info, _ := os.Stat(store.path)
	if info.Mode().Perm() != 0o600 {
		t.Errorf("auth file mode = %v, want 0600", info.Mode().Perm())
	}
	content, _ := os.ReadFile(store.path)
	if strings.Contains(string(content), "secret-password") {
		t.Error("plaintext password persisted")
	}
}

func TestLastAdminIsProtected(t *testing.T) {
	store := newTestStore(t)
	if err := store.Create("admin", "password1", RoleAdmin); err != nil {
		t.Fatal(err)
	}
	if err := store.Create("bob", "password2", RoleViewer); err != nil {
		t.Fatal(err)
	}

	if err := store.Delete("admin"); !errors.Is(err, ErrLastAdmin) {
		t.Fatalf("deleting last admin = %v, want ErrLastAdmin", err)
	}
	viewer := RoleViewer
	if err := store.Update("admin", &viewer, nil); !errors.Is(err, ErrLastAdmin) {
		t.Fatalf("demoting last admin = %v, want ErrLastAdmin", err)
	}

	// A second admin unlocks both operations.
	if err := store.Create("root", "password3", RoleAdmin); err != nil {
		t.Fatal(err)
	}
	if err := store.Update("admin", &viewer, nil); err != nil {
		t.Fatalf("demote with two admins: %v", err)
	}
}

func TestSessionRoundTripAndRevocation(t *testing.T) {
	store := newTestStore(t)
	if err := store.Create("lionel", "secret-password", RoleEditor); err != nil {
		t.Fatal(err)
	}
	secret, err := store.SessionSecret()
	if err != nil {
		t.Fatal(err)
	}
	user, _ := store.Get("lionel")
	cookie, err := NewSessionCookie(user, secret, false)
	if err != nil {
		t.Fatal(err)
	}

	request := httptest.NewRequest("GET", "/", nil)
	request.AddCookie(cookie)
	resolved, err := store.UserFromRequest(request, secret)
	if err != nil {
		t.Fatalf("UserFromRequest: %v", err)
	}
	if resolved.Username != "lionel" || resolved.Role != RoleEditor {
		t.Fatalf("resolved = %+v", resolved)
	}

	// A password change bumps the session version: old cookies die.
	newPassword := "another-password"
	if err := store.Update("lionel", nil, &newPassword); err != nil {
		t.Fatal(err)
	}
	if _, err := store.UserFromRequest(request, secret); err == nil {
		t.Fatal("old session should be revoked after password change")
	}

	// Tampered cookies are rejected.
	tampered := httptest.NewRequest("GET", "/", nil)
	tampered.AddCookie(&http.Cookie{Name: SessionCookie, Value: cookie.Value + "x"})
	if _, err := store.UserFromRequest(tampered, secret); err == nil {
		t.Fatal("tampered session accepted")
	}
}

func TestRoleParsingAndRanks(t *testing.T) {
	if _, err := ParseRole("root"); err == nil {
		t.Fatal("invalid role accepted")
	}
	if !RoleAdmin.Allows(RoleViewer) || RoleViewer.Allows(RoleEditor) {
		t.Fatal("role ranks broken")
	}
}
