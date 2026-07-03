package auth

import (
	"fmt"
	"net"
	"net/http"
	"strings"
)

// ProxyConfig configures trusted-reverse-proxy authentication: an
// authenticating proxy (Authelia, Authentik, oauth2-proxy, Tailscale…)
// sits in front and injects the identity as request headers.
type ProxyConfig struct {
	// UserHeader carries the username; its presence enables proxy mode.
	UserHeader string `yaml:"user_header"`
	// GroupsHeader carries the groups (optional).
	GroupsHeader string `yaml:"groups_header"`
	// GroupsDelimiter splits the groups header (default ",").
	GroupsDelimiter string `yaml:"groups_delimiter"`
	// RoleMapping turns groups into a role.
	RoleMapping RoleMapping `yaml:"role_mapping"`
	// TrustedProxies is a CIDR allowlist of peers whose headers are
	// honored. Empty means honor from any source — only safe when the
	// backend is never reachable except through the proxy.
	TrustedProxies []string `yaml:"trusted_proxies"`
}

// ProxyAuthenticator resolves the request identity from proxy headers.
type ProxyAuthenticator struct {
	config  ProxyConfig
	trusted []*net.IPNet
}

// NewProxyAuthenticator validates the config; returns nil when proxy auth
// is not configured (no user header).
func NewProxyAuthenticator(config ProxyConfig) (*ProxyAuthenticator, error) {
	if config.UserHeader == "" {
		return nil, nil
	}
	authenticator := &ProxyAuthenticator{config: config}
	for _, cidr := range config.TrustedProxies {
		_, network, err := net.ParseCIDR(cidr)
		if err != nil {
			return nil, fmt.Errorf("auth.proxy.trusted_proxies: %q is not a CIDR: %w", cidr, err)
		}
		authenticator.trusted = append(authenticator.trusted, network)
	}
	return authenticator, nil
}

// TrustsAnySource reports whether no CIDR allowlist is set (used for the
// startup warning).
func (p *ProxyAuthenticator) TrustsAnySource() bool {
	return len(p.trusted) == 0
}

func (p *ProxyAuthenticator) peerTrusted(r *http.Request) bool {
	if len(p.trusted) == 0 {
		return true
	}
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		host = r.RemoteAddr
	}
	ip := net.ParseIP(host)
	if ip == nil {
		return false
	}
	for _, network := range p.trusted {
		if network.Contains(ip) {
			return true
		}
	}
	return false
}

// errProxyDenied is returned when the request carries no trusted identity
// or maps to no role.
var errProxyDenied = fmt.Errorf("proxy authentication denied")

// Identify resolves the user from the proxy headers, or returns an error
// (which the caller turns into 401/403).
func (p *ProxyAuthenticator) Identify(r *http.Request) (User, error) {
	if !p.peerTrusted(r) {
		return User{}, errProxyDenied
	}
	username := strings.TrimSpace(r.Header.Get(p.config.UserHeader))
	if username == "" {
		return User{}, errProxyDenied
	}
	var groups []string
	if p.config.GroupsHeader != "" {
		delimiter := p.config.GroupsDelimiter
		if delimiter == "" {
			delimiter = ","
		}
		for _, group := range strings.Split(r.Header.Get(p.config.GroupsHeader), delimiter) {
			if trimmed := strings.TrimSpace(group); trimmed != "" {
				groups = append(groups, trimmed)
			}
		}
	}
	role, ok := p.config.RoleMapping.MapRole(groups)
	if !ok {
		// Authenticated by the proxy but no role rule matches: deny.
		return User{}, errProxyDenied
	}
	return User{Username: username, Role: role}, nil
}

// Mapping exposes the configured role mapping (admin config view).
func (p *ProxyAuthenticator) Mapping() RoleMapping {
	return p.config.RoleMapping
}
