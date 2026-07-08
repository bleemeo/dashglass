package api

import (
	"encoding/json"
	"net/http"
	"testing"

	"github.com/bleemeo/dashglass/backend/internal/auth"
)

func newProxyServer(t *testing.T) string {
	t.Helper()
	proxyAuth, err := auth.NewProxyAuthenticator(auth.ProxyConfig{
		UserHeader:   "Remote-User",
		GroupsHeader: "Remote-Groups",
		RoleMapping: auth.RoleMapping{
			Admin:  []string{"admins"},
			Editor: []string{"editors"},
			Viewer: []string{"*"},
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	server := newTestServer(t, Options{ProxyAuth: proxyAuth})
	return server.URL
}

func proxyGet(t *testing.T, url, user, groups string) *http.Response {
	t.Helper()
	request, _ := http.NewRequest(http.MethodGet, url, nil)
	if user != "" {
		request.Header.Set("Remote-User", user)
	}
	if groups != "" {
		request.Header.Set("Remote-Groups", groups)
	}
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { response.Body.Close() })
	return response
}

func TestProxyModeEnforcesRoles(t *testing.T) {
	url := newProxyServer(t)

	// No headers at all → 401 (proxy misconfigured / direct access).
	if got := proxyGet(t, url+"/api/dashboards", "", "").StatusCode; got != http.StatusUnauthorized {
		t.Errorf("no headers = %d, want 401", got)
	}

	// Editor can read, viewer cannot write, admin reaches /api/admin.
	if got := proxyGet(t, url+"/api/dashboards", "ed", "editors").StatusCode; got != http.StatusOK {
		t.Errorf("editor list = %d, want 200", got)
	}
	viewerAdmin := proxyGet(t, url+"/api/admin/users", "viewer", "guests")
	if viewerAdmin.StatusCode != http.StatusForbidden {
		t.Errorf("viewer admin = %d, want 403", viewerAdmin.StatusCode)
	}
	adminAdmin := proxyGet(t, url+"/api/admin/users", "boss", "admins")
	if adminAdmin.StatusCode != http.StatusOK {
		t.Errorf("admin admin = %d, want 200", adminAdmin.StatusCode)
	}
}

func TestProxyModeCapabilitiesAndLogin(t *testing.T) {
	url := newProxyServer(t)

	response := proxyGet(t, url+"/api/capabilities", "boss", "admins")
	var body struct {
		Auth struct {
			Kind string `json:"kind"`
		} `json:"auth"`
	}
	if err := json.NewDecoder(response.Body).Decode(&body); err != nil {
		t.Fatal(err)
	}
	if body.Auth.Kind != "proxy" {
		t.Errorf("auth kind = %q, want proxy", body.Auth.Kind)
	}

	// Local login is disabled in proxy mode.
	request, _ := http.NewRequest(http.MethodPost, url+"/api/auth/login", nil)
	login, err := http.DefaultClient.Do(request)
	if err != nil {
		t.Fatal(err)
	}
	login.Body.Close()
	if login.StatusCode != http.StatusBadRequest {
		t.Errorf("login in proxy mode = %d, want 400", login.StatusCode)
	}
}
