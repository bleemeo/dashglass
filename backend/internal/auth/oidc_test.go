package auth

import (
	"context"
	"crypto/rand"
	"crypto/rsa"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"testing"
	"time"

	"github.com/go-jose/go-jose/v4"
	"github.com/go-jose/go-jose/v4/jwt"
)

func TestExtractGroups(t *testing.T) {
	cases := []struct {
		in   any
		want []string
	}{
		{[]any{"a", "b"}, []string{"a", "b"}},
		{[]any{"a", 3, "b"}, []string{"a", "b"}}, // non-strings dropped
		{"solo", []string{"solo"}},
		{"", nil},
		{nil, nil},
		{42, nil},
	}
	for _, c := range cases {
		got := extractGroups(c.in)
		if len(got) != len(c.want) {
			t.Errorf("extractGroups(%v) = %v, want %v", c.in, got, c.want)
			continue
		}
		for i := range got {
			if got[i] != c.want[i] {
				t.Errorf("extractGroups(%v) = %v, want %v", c.in, got, c.want)
			}
		}
	}
}

// mockIssuer serves an OIDC discovery document, a JWKS and mints signed
// ID tokens, enough to exercise the real token-verification path.
type mockIssuer struct {
	server       *httptest.Server
	key          *rsa.PrivateKey
	signer       jose.Signer
	currentToken string // id_token the /token endpoint returns next
}

func newMockIssuer(t *testing.T) *mockIssuer {
	return newMockIssuerServer(t, httptest.NewServer)
}

// newMockIssuerTLS serves the same issuer over TLS with httptest's
// self-signed certificate (exercises insecure_skip_verify).
func newMockIssuerTLS(t *testing.T) *mockIssuer {
	return newMockIssuerServer(t, httptest.NewTLSServer)
}

func newMockIssuerServer(t *testing.T, start func(http.Handler) *httptest.Server) *mockIssuer {
	t.Helper()
	key, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatal(err)
	}
	signer, err := jose.NewSigner(
		jose.SigningKey{Algorithm: jose.RS256, Key: key},
		(&jose.SignerOptions{}).WithType("JWT").WithHeader("kid", "test"),
	)
	if err != nil {
		t.Fatal(err)
	}
	m := &mockIssuer{key: key, signer: signer}
	mux := http.NewServeMux()
	mux.HandleFunc("/.well-known/openid-configuration", func(w http.ResponseWriter, _ *http.Request) {
		json.NewEncoder(w).Encode(map[string]any{
			"issuer":                                m.server.URL,
			"authorization_endpoint":                m.server.URL + "/auth",
			"token_endpoint":                        m.server.URL + "/token",
			"jwks_uri":                              m.server.URL + "/jwks",
			"id_token_signing_alg_values_supported": []string{"RS256"},
		})
	})
	mux.HandleFunc("/jwks", func(w http.ResponseWriter, _ *http.Request) {
		jwks := jose.JSONWebKeySet{Keys: []jose.JSONWebKey{
			{Key: key.Public(), KeyID: "test", Algorithm: "RS256", Use: "sig"},
		}}
		json.NewEncoder(w).Encode(jwks)
	})
	// token endpoint returns an access token plus a signed id_token.
	mux.HandleFunc("/token", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]any{
			"access_token": "at",
			"token_type":   "Bearer",
			"id_token":     m.currentToken,
		})
	})
	m.server = start(mux)
	t.Cleanup(m.server.Close)
	return m
}

func (m *mockIssuer) mintToken(t *testing.T, clientID, nonce string, claims map[string]any) string {
	t.Helper()
	all := map[string]any{
		"iss":   m.server.URL,
		"aud":   clientID,
		"exp":   time.Now().Add(time.Hour).Unix(),
		"iat":   time.Now().Unix(),
		"sub":   "user-sub",
		"nonce": nonce,
	}
	for k, v := range claims {
		all[k] = v
	}
	token, err := jwt.Signed(m.signer).Claims(all).Serialize()
	if err != nil {
		t.Fatal(err)
	}
	return token
}

func TestOIDCCompleteHappyPath(t *testing.T) {
	issuer := newMockIssuer(t)
	const clientID = "dashglass"

	authn, err := NewOIDCAuthenticator(context.Background(), OIDCConfig{
		Issuer:      issuer.server.URL,
		ClientID:    clientID,
		RedirectURL: "http://dashglass.local/api/auth/oidc/callback",
		RoleMapping: RoleMapping{Admin: []string{"ops"}, Viewer: []string{"*"}},
	})
	if err != nil {
		t.Fatalf("NewOIDCAuthenticator: %v", err)
	}

	_, flow := authn.Start()
	issuer.currentToken = issuer.mintToken(t, clientID, flow.Nonce, map[string]any{
		"preferred_username": "lionel",
		"groups":             []any{"ops", "staff"},
	})

	callback := httptest.NewRequest("GET", "/api/auth/oidc/callback?code=abc&state="+url.QueryEscape(flow.State), nil)
	user, err := authn.Complete(context.Background(), callback, flow)
	if err != nil {
		t.Fatalf("Complete: %v", err)
	}
	if user.Username != "lionel" || user.Role != RoleAdmin {
		t.Fatalf("user = %+v, want lionel/admin", user)
	}
}

func TestOIDCInsecureSkipVerify(t *testing.T) {
	issuer := newMockIssuerTLS(t)
	const clientID = "dashglass"
	base := OIDCConfig{
		Issuer:      issuer.server.URL,
		ClientID:    clientID,
		RedirectURL: "http://dashglass.local/api/auth/oidc/callback",
		RoleMapping: RoleMapping{Viewer: []string{"*"}},
	}

	// Self-signed issuer certificate → discovery is refused by default.
	if _, err := NewOIDCAuthenticator(context.Background(), base); err == nil {
		t.Fatal("discovery against a self-signed issuer should fail without insecure_skip_verify")
	}

	config := base
	config.InsecureSkipVerify = true
	authn, err := NewOIDCAuthenticator(context.Background(), config)
	if err != nil {
		t.Fatalf("NewOIDCAuthenticator: %v", err)
	}

	// The whole flow — token exchange and JWKS fetch — must skip
	// verification too, not just discovery.
	_, flow := authn.Start()
	issuer.currentToken = issuer.mintToken(t, clientID, flow.Nonce, map[string]any{
		"preferred_username": "lionel",
		"groups":             []any{"staff"},
	})
	callback := httptest.NewRequest("GET", "/api/auth/oidc/callback?code=abc&state="+url.QueryEscape(flow.State), nil)
	user, err := authn.Complete(context.Background(), callback, flow)
	if err != nil {
		t.Fatalf("Complete: %v", err)
	}
	if user.Username != "lionel" || user.Role != RoleViewer {
		t.Fatalf("user = %+v, want lionel/viewer", user)
	}
}

func TestOIDCCompleteRejects(t *testing.T) {
	issuer := newMockIssuer(t)
	const clientID = "dashglass"
	authn, _ := NewOIDCAuthenticator(context.Background(), OIDCConfig{
		Issuer:      issuer.server.URL,
		ClientID:    clientID,
		RedirectURL: "http://dashglass.local/cb",
		RoleMapping: RoleMapping{Admin: []string{"ops"}}, // no "*"
	})
	_, flow := authn.Start()

	// State mismatch → rejected before any exchange.
	bad := httptest.NewRequest("GET", "/cb?code=abc&state=wrong", nil)
	if _, err := authn.Complete(context.Background(), bad, flow); err == nil {
		t.Error("state mismatch should be rejected")
	}

	// Valid token but groups map to no role (deny-by-default).
	issuer.currentToken = issuer.mintToken(t, clientID, flow.Nonce, map[string]any{
		"preferred_username": "bob",
		"groups":             []any{"randos"},
	})
	req := httptest.NewRequest("GET", "/cb?code=abc&state="+url.QueryEscape(flow.State), nil)
	if _, err := authn.Complete(context.Background(), req, flow); err == nil {
		t.Error("unmapped groups should be denied")
	}

	// Nonce mismatch → rejected.
	issuer.currentToken = issuer.mintToken(t, clientID, "wrong-nonce", map[string]any{
		"preferred_username": "bob",
		"groups":             []any{"ops"},
	})
	if _, err := authn.Complete(context.Background(), req, flow); err == nil {
		t.Error("nonce mismatch should be rejected")
	}
}

func TestExternalSessionRoundTrip(t *testing.T) {
	secret := []byte("0123456789abcdef0123456789abcdef")
	cookie, err := NewExternalSessionCookie("lionel", RoleEditor, secret, false)
	if err != nil {
		t.Fatal(err)
	}
	r := httptest.NewRequest("GET", "/", nil)
	r.AddCookie(cookie)
	user, err := VerifyExternalSession(r, secret)
	if err != nil || user.Username != "lionel" || user.Role != RoleEditor {
		t.Fatalf("round trip = %+v, %v", user, err)
	}
	// Wrong secret → rejected.
	if _, err := VerifyExternalSession(r, []byte("wrong-secret-wrong-secret-wrong!")); err == nil {
		t.Error("bad signature accepted")
	}
}
