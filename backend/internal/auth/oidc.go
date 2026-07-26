package auth

import (
	"context"
	"crypto/rand"
	"crypto/tls"
	"encoding/base64"
	"fmt"
	"net/http"
	"time"

	"github.com/coreos/go-oidc/v3/oidc"
	"golang.org/x/oauth2"
)

// OIDCConfig configures native OpenID Connect login (DESIGN.md §7.4).
type OIDCConfig struct {
	Issuer       string `yaml:"issuer"`
	ClientID     string `yaml:"client_id"`
	ClientSecret string `yaml:"client_secret"`
	// RedirectURL is the public callback URL (…/api/auth/oidc/callback).
	RedirectURL string `yaml:"redirect_url"`
	// Scopes requested; "openid" is always added. Default adds
	// "profile email groups".
	Scopes []string `yaml:"scopes"`
	// GroupsClaim is the ID-token claim holding the user's groups
	// (default "groups").
	GroupsClaim string `yaml:"groups_claim"`
	// UsernameClaim identifies the user (default "preferred_username",
	// then "email", then "sub").
	UsernameClaim string      `yaml:"username_claim"`
	RoleMapping   RoleMapping `yaml:"role_mapping"`
	// InsecureSkipVerify disables TLS certificate verification for every
	// call to the provider (discovery, JWKS, token endpoint). Only for
	// issuers with self-signed or otherwise unverifiable certificates —
	// it lets anyone on the network path impersonate the provider.
	InsecureSkipVerify bool `yaml:"insecure_skip_verify"`
}

// OIDCAuthenticator drives the authorization-code flow and maps the
// resulting identity to a role.
type OIDCAuthenticator struct {
	config       OIDCConfig
	provider     *oidc.Provider
	verifier     *oidc.IDTokenVerifier
	oauth        oauth2.Config
	groupsClaim  string
	usernameKeys []string
	// httpClient overrides the client used to reach the provider
	// (insecure_skip_verify); nil means the default client.
	httpClient *http.Client
}

// NewOIDCAuthenticator discovers the provider and builds the flow; returns
// nil when OIDC is not configured (no issuer).
func NewOIDCAuthenticator(ctx context.Context, config OIDCConfig) (*OIDCAuthenticator, error) {
	if config.Issuer == "" {
		return nil, nil
	}
	if config.ClientID == "" || config.RedirectURL == "" {
		return nil, fmt.Errorf("auth.oidc: issuer, client_id and redirect_url are required")
	}
	var httpClient *http.Client
	if config.InsecureSkipVerify {
		transport := http.DefaultTransport.(*http.Transport).Clone()
		transport.TLSClientConfig = &tls.Config{InsecureSkipVerify: true}
		httpClient = &http.Client{Transport: transport}
		// go-oidc and oauth2 both take their HTTP client from the
		// context; the provider keeps it for later JWKS fetches.
		ctx = oidc.ClientContext(ctx, httpClient)
	}
	provider, err := oidc.NewProvider(ctx, config.Issuer)
	if err != nil {
		return nil, fmt.Errorf("auth.oidc: discovering %s: %w", config.Issuer, err)
	}
	scopes := config.Scopes
	if len(scopes) == 0 {
		scopes = []string{"profile", "email", "groups"}
	}
	groupsClaim := config.GroupsClaim
	if groupsClaim == "" {
		groupsClaim = "groups"
	}
	usernameKeys := []string{config.UsernameClaim, "preferred_username", "email", "sub"}
	return &OIDCAuthenticator{
		config:       config,
		provider:     provider,
		verifier:     provider.Verifier(&oidc.Config{ClientID: config.ClientID}),
		groupsClaim:  groupsClaim,
		usernameKeys: usernameKeys,
		httpClient:   httpClient,
		oauth: oauth2.Config{
			ClientID:     config.ClientID,
			ClientSecret: config.ClientSecret,
			RedirectURL:  config.RedirectURL,
			Endpoint:     provider.Endpoint(),
			Scopes:       append([]string{oidc.ScopeOpenID}, scopes...),
		},
	}, nil
}

// flowState is signed into a short-lived cookie to bind the callback to
// this browser (CSRF) and carry the PKCE verifier and nonce.
type OIDCFlow struct {
	State    string
	Nonce    string
	Verifier string
}

func randomToken() string {
	raw := make([]byte, 24)
	rand.Read(raw)
	return base64.RawURLEncoding.EncodeToString(raw)
}

// Start returns the provider authorization URL and the flow secrets the
// caller must store (signed) for the callback to verify.
func (a *OIDCAuthenticator) Start() (authURL string, flow OIDCFlow) {
	verifier := oauth2.GenerateVerifier()
	flow = OIDCFlow{State: randomToken(), Nonce: randomToken(), Verifier: verifier}
	authURL = a.oauth.AuthCodeURL(flow.State,
		oidc.Nonce(flow.Nonce),
		oauth2.S256ChallengeOption(verifier),
	)
	return authURL, flow
}

// Complete exchanges the code, verifies the ID token against the stored
// flow, maps groups to a role and returns the user (or an error to deny).
func (a *OIDCAuthenticator) Complete(ctx context.Context, r *http.Request, flow OIDCFlow) (User, error) {
	if a.httpClient != nil {
		ctx = oidc.ClientContext(ctx, a.httpClient)
	}
	if r.URL.Query().Get("state") != flow.State {
		return User{}, fmt.Errorf("state mismatch")
	}
	code := r.URL.Query().Get("code")
	if code == "" {
		return User{}, fmt.Errorf("missing code")
	}
	token, err := a.oauth.Exchange(ctx, code, oauth2.VerifierOption(flow.Verifier))
	if err != nil {
		return User{}, fmt.Errorf("token exchange: %w", err)
	}
	rawID, ok := token.Extra("id_token").(string)
	if !ok {
		return User{}, fmt.Errorf("no id_token in response")
	}
	idToken, err := a.verifier.Verify(ctx, rawID)
	if err != nil {
		return User{}, fmt.Errorf("verifying id_token: %w", err)
	}
	if idToken.Nonce != flow.Nonce {
		return User{}, fmt.Errorf("nonce mismatch")
	}

	var claims map[string]any
	if err := idToken.Claims(&claims); err != nil {
		return User{}, fmt.Errorf("reading claims: %w", err)
	}
	username := a.username(claims)
	if username == "" {
		return User{}, fmt.Errorf("no username claim")
	}
	role, ok := a.config.RoleMapping.MapRole(extractGroups(claims[a.groupsClaim]))
	if !ok {
		return User{}, fmt.Errorf("no role mapping matched for %q", username)
	}
	return User{Username: username, Role: role}, nil
}

func (a *OIDCAuthenticator) username(claims map[string]any) string {
	for _, key := range a.usernameKeys {
		if key == "" {
			continue
		}
		if value, ok := claims[key].(string); ok && value != "" {
			return value
		}
	}
	return ""
}

// extractGroups reads the groups claim, which providers encode either as a
// JSON array or (rarely) a single string.
func extractGroups(raw any) []string {
	switch value := raw.(type) {
	case []any:
		groups := make([]string, 0, len(value))
		for _, item := range value {
			if str, ok := item.(string); ok {
				groups = append(groups, str)
			}
		}
		return groups
	case []string:
		return value
	case string:
		if value == "" {
			return nil
		}
		return []string{value}
	default:
		return nil
	}
}

// Mapping exposes the configured role mapping (admin config view).
func (a *OIDCAuthenticator) Mapping() RoleMapping { return a.config.RoleMapping }

// FlowCookieTTL bounds how long a login round-trip may take.
const FlowCookieTTL = 10 * time.Minute
