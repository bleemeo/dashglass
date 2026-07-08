package api

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/bleemeo/dashglass/backend/internal/auth"
)

// discoveryOnlyIssuer serves just the discovery document — enough to build
// an OIDCAuthenticator and exercise the API glue (login redirect, callback
// rejection); the full token path is covered in the auth package.
func discoveryOnlyIssuer(t *testing.T) *httptest.Server {
	t.Helper()
	mux := http.NewServeMux()
	var base string
	server := httptest.NewServer(mux)
	base = server.URL
	mux.HandleFunc("/.well-known/openid-configuration", func(w http.ResponseWriter, _ *http.Request) {
		json.NewEncoder(w).Encode(map[string]any{
			"issuer":                 base,
			"authorization_endpoint": base + "/auth",
			"token_endpoint":         base + "/token",
			"jwks_uri":               base + "/jwks",
			"id_token_signing_alg_values_supported": []string{"RS256"},
		})
	})
	t.Cleanup(server.Close)
	return server
}

func newOIDCServer(t *testing.T) (string, *auth.Store) {
	t.Helper()
	issuer := discoveryOnlyIssuer(t)
	oidcAuth, err := auth.NewOIDCAuthenticator(context.Background(), auth.OIDCConfig{
		Issuer:      issuer.URL,
		ClientID:    "dashglass",
		RedirectURL: "http://dashglass.local/api/auth/oidc/callback",
		RoleMapping: auth.RoleMapping{Admin: []string{"ops"}},
	})
	if err != nil {
		t.Fatal(err)
	}
	store, err := auth.NewStore(t.TempDir() + "/auth.yaml")
	if err != nil {
		t.Fatal(err)
	}
	server := newTestServer(t, Options{Auth: store, OIDC: oidcAuth})
	return server.URL, store
}

func TestOIDCLoginRedirects(t *testing.T) {
	url, _ := newOIDCServer(t)
	client := &http.Client{
		CheckRedirect: func(*http.Request, []*http.Request) error {
			return http.ErrUseLastResponse // don't follow to the provider
		},
	}
	resp, err := client.Get(url + "/api/auth/oidc/login")
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusFound {
		t.Fatalf("login status = %d, want 302", resp.StatusCode)
	}
	if loc := resp.Header.Get("Location"); !strings.Contains(loc, "/auth?") ||
		!strings.Contains(loc, "code_challenge") {
		t.Errorf("redirect Location missing PKCE challenge: %s", loc)
	}
	// The flow cookie (state/nonce/verifier) must be set for the callback.
	var hasFlow bool
	for _, c := range resp.Cookies() {
		if c.Name == oidcFlowCookie {
			hasFlow = true
		}
	}
	if !hasFlow {
		t.Error("login did not set the OIDC flow cookie")
	}
}

func TestOIDCCallbackWithoutFlowRedirectsToLogin(t *testing.T) {
	url, _ := newOIDCServer(t)
	client := &http.Client{
		CheckRedirect: func(*http.Request, []*http.Request) error {
			return http.ErrUseLastResponse
		},
	}
	resp, err := client.Get(url + "/api/auth/oidc/callback?code=x&state=y")
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusFound {
		t.Fatalf("callback status = %d, want 302", resp.StatusCode)
	}
	if loc := resp.Header.Get("Location"); !strings.HasPrefix(loc, "/login?error") {
		t.Errorf("expected redirect to /login?error, got %s", loc)
	}
}

func TestOIDCCapabilitiesKind(t *testing.T) {
	url, _ := newOIDCServer(t)
	resp := doJSON(t, http.DefaultClient, http.MethodGet, url+"/api/capabilities", "")
	var body struct {
		Auth struct {
			Kind string `json:"kind"`
		} `json:"auth"`
	}
	json.NewDecoder(resp.Body).Decode(&body)
	if body.Auth.Kind != "oidc" {
		t.Errorf("auth kind = %q, want oidc", body.Auth.Kind)
	}
}
