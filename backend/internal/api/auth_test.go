package api

import (
	"encoding/json"
	"net/http"
	"net/http/cookiejar"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"

	"github.com/bleemeo/dashglass/backend/internal/auth"
)

func newAuthServer(t *testing.T) (*httptest.Server, *auth.Store) {
	t.Helper()
	authStore, err := auth.NewStore(filepath.Join(t.TempDir(), "auth.yaml"))
	if err != nil {
		t.Fatal(err)
	}
	return newTestServer(t, Options{Auth: authStore}), authStore
}

func doJSON(t *testing.T, client *http.Client, method, target, body string) *http.Response {
	t.Helper()
	request, err := http.NewRequest(method, target, strings.NewReader(body))
	if err != nil {
		t.Fatal(err)
	}
	request.Header.Set("Content-Type", "application/json")
	response, err := client.Do(request)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { response.Body.Close() })
	return response
}

// While auth is disabled everyone is an anonymous admin — that is what
// makes the no-CLI bootstrap possible.
func TestAnonymousAdminUntilFirstUser(t *testing.T) {
	server, _ := newAuthServer(t)
	client := server.Client()

	response := doJSON(t, client, http.MethodGet, server.URL+"/api/admin/users", "")
	if response.StatusCode != http.StatusOK {
		t.Fatalf("admin users while disabled: %d", response.StatusCode)
	}

	// First user must be an admin.
	response = doJSON(t, client, http.MethodPost, server.URL+"/api/admin/users",
		`{"username":"bob","password":"password123","role":"viewer"}`)
	if response.StatusCode != http.StatusBadRequest {
		t.Fatalf("first non-admin user: %d, want 400", response.StatusCode)
	}
	response = doJSON(t, client, http.MethodPost, server.URL+"/api/admin/users",
		`{"username":"lionel","password":"password123","role":"admin"}`)
	if response.StatusCode != http.StatusOK {
		t.Fatalf("create first admin: %d", response.StatusCode)
	}

	// Auth is now enabled: anonymous access is gone.
	response = doJSON(t, client, http.MethodGet, server.URL+"/api/dashboards", "")
	if response.StatusCode != http.StatusUnauthorized {
		t.Fatalf("dashboards after enabling auth: %d, want 401", response.StatusCode)
	}
}

func TestLoginSessionAndRoles(t *testing.T) {
	server, authStore := newAuthServer(t)
	if err := authStore.Create("admin", "password123", auth.RoleAdmin); err != nil {
		t.Fatal(err)
	}
	if err := authStore.Create("viewer", "password456", auth.RoleViewer); err != nil {
		t.Fatal(err)
	}

	// Cookie-aware client.
	jar := newCookieClient(t, server)

	// Wrong password → 401; throttling kicks in after repeated failures.
	response := doJSON(t, jar, http.MethodPost, server.URL+"/api/auth/login",
		`{"username":"admin","password":"nope"}`)
	if response.StatusCode != http.StatusUnauthorized {
		t.Fatalf("bad login: %d", response.StatusCode)
	}

	response = doJSON(t, jar, http.MethodPost, server.URL+"/api/auth/login",
		`{"username":"viewer","password":"password456"}`)
	if response.StatusCode != http.StatusOK {
		t.Fatalf("login: %d", response.StatusCode)
	}

	// Viewer can read but not write.
	response = doJSON(t, jar, http.MethodGet, server.URL+"/api/dashboards", "")
	if response.StatusCode != http.StatusOK {
		t.Fatalf("viewer list: %d", response.StatusCode)
	}
	request, _ := http.NewRequest(http.MethodPut, server.URL+"/api/dashboards/x", strings.NewReader(validYAML))
	request.Header.Set("Content-Type", "application/yaml")
	putResponse, err := jar.Do(request)
	if err != nil {
		t.Fatal(err)
	}
	putResponse.Body.Close()
	if putResponse.StatusCode != http.StatusForbidden {
		t.Fatalf("viewer write: %d, want 403", putResponse.StatusCode)
	}
	response = doJSON(t, jar, http.MethodGet, server.URL+"/api/admin/users", "")
	if response.StatusCode != http.StatusForbidden {
		t.Fatalf("viewer admin: %d, want 403", response.StatusCode)
	}

	// /api/auth/me reflects the session.
	response = doJSON(t, jar, http.MethodGet, server.URL+"/api/auth/me", "")
	var me struct {
		Authenticated bool   `json:"authenticated"`
		Role          string `json:"role"`
	}
	if err := json.NewDecoder(response.Body).Decode(&me); err != nil {
		t.Fatal(err)
	}
	if !me.Authenticated || me.Role != "viewer" {
		t.Fatalf("me = %+v", me)
	}

	// Logout kills the session.
	doJSON(t, jar, http.MethodPost, server.URL+"/api/auth/logout", "")
	response = doJSON(t, jar, http.MethodGet, server.URL+"/api/dashboards", "")
	if response.StatusCode != http.StatusUnauthorized {
		t.Fatalf("after logout: %d, want 401", response.StatusCode)
	}
}

func TestCapabilitiesAdvertiseAuthKind(t *testing.T) {
	server, authStore := newAuthServer(t)
	read := func() string {
		response := doJSON(t, server.Client(), http.MethodGet, server.URL+"/api/capabilities", "")
		var caps struct {
			Auth struct {
				Kind string `json:"kind"`
			} `json:"auth"`
		}
		json.NewDecoder(response.Body).Decode(&caps)
		return caps.Auth.Kind
	}
	if kind := read(); kind != "none" {
		t.Fatalf("kind = %q, want none", kind)
	}
	if err := authStore.Create("admin", "password123", auth.RoleAdmin); err != nil {
		t.Fatal(err)
	}
	if kind := read(); kind != "builtin" {
		t.Fatalf("kind = %q, want builtin", kind)
	}
}

func newCookieClient(t *testing.T, server *httptest.Server) *http.Client {
	t.Helper()
	client := server.Client()
	jar, err := newJar()
	if err != nil {
		t.Fatal(err)
	}
	client.Jar = jar
	return client
}

func newJar() (http.CookieJar, error) {
	return cookiejar.New(nil)
}

func TestLogoutEverywhereRevokesOtherSessions(t *testing.T) {
	server, _ := newAuthServer(t)
	if _, err := server.Client().Post(
		server.URL+"/api/admin/users", "application/json",
		strings.NewReader(`{"username":"lionel","password":"password123","role":"admin"}`),
	); err != nil {
		t.Fatal(err)
	}

	signIn := func() *http.Client {
		jar, _ := cookiejar.New(nil)
		client := &http.Client{Jar: jar}
		doJSON(t, client, http.MethodPost, server.URL+"/api/auth/login",
			`{"username":"lionel","password":"password123"}`)
		return client
	}
	deviceA := signIn()
	deviceB := signIn()

	// Both sessions work.
	for _, client := range []*http.Client{deviceA, deviceB} {
		if r := doJSON(t, client, http.MethodGet, server.URL+"/api/dashboards", ""); r.StatusCode != http.StatusOK {
			t.Fatalf("session should be valid: %d", r.StatusCode)
		}
	}

	// Sign out everywhere from device A.
	if r := doJSON(t, deviceA, http.MethodPost, server.URL+"/api/auth/logout-all", ""); r.StatusCode != http.StatusNoContent {
		t.Fatalf("logout-all: %d, want 204", r.StatusCode)
	}

	// Device B (a different session) is now revoked too.
	if r := doJSON(t, deviceB, http.MethodGet, server.URL+"/api/dashboards", ""); r.StatusCode != http.StatusUnauthorized {
		t.Fatalf("other session after logout-all: %d, want 401", r.StatusCode)
	}
}

func TestSelfServicePasswordChange(t *testing.T) {
	server, _ := newAuthServer(t)
	client := server.Client()

	// Bootstrap an admin, then sign in with a cookie jar.
	response := doJSON(t, client, http.MethodPost, server.URL+"/api/admin/users",
		`{"username":"lionel","password":"password123","role":"admin"}`)
	if response.StatusCode != http.StatusOK {
		t.Fatalf("create admin: %d", response.StatusCode)
	}
	jar, err := cookiejar.New(nil)
	if err != nil {
		t.Fatal(err)
	}
	session := &http.Client{Jar: jar}
	response = doJSON(t, session, http.MethodPost, server.URL+"/api/auth/login",
		`{"username":"lionel","password":"password123"}`)
	if response.StatusCode != http.StatusOK {
		t.Fatalf("login: %d", response.StatusCode)
	}

	// Wrong current password is refused.
	response = doJSON(t, session, http.MethodPost, server.URL+"/api/auth/password",
		`{"current":"nope","new":"granted456"}`)
	if response.StatusCode != http.StatusForbidden {
		t.Fatalf("wrong current password: %d, want 403", response.StatusCode)
	}

	// Correct current password changes it and keeps this session alive
	// (a fresh cookie rides the response through the jar).
	response = doJSON(t, session, http.MethodPost, server.URL+"/api/auth/password",
		`{"current":"password123","new":"granted456"}`)
	if response.StatusCode != http.StatusNoContent {
		t.Fatalf("password change: %d, want 204", response.StatusCode)
	}
	response = doJSON(t, session, http.MethodGet, server.URL+"/api/dashboards", "")
	if response.StatusCode != http.StatusOK {
		t.Fatalf("session after change: %d, want 200", response.StatusCode)
	}

	// Old password no longer signs in; the new one does.
	response = doJSON(t, client, http.MethodPost, server.URL+"/api/auth/login",
		`{"username":"lionel","password":"password123"}`)
	if response.StatusCode != http.StatusUnauthorized {
		t.Fatalf("old password login: %d, want 401", response.StatusCode)
	}
	response = doJSON(t, client, http.MethodPost, server.URL+"/api/auth/login",
		`{"username":"lionel","password":"granted456"}`)
	if response.StatusCode != http.StatusOK {
		t.Fatalf("new password login: %d, want 200", response.StatusCode)
	}
}
