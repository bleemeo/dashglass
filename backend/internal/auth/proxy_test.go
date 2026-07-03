package auth

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func proxyRequest(user, groups, remoteAddr string, headers ...string) *http.Request {
	r := httptest.NewRequest("GET", "/", nil)
	r.RemoteAddr = remoteAddr
	userHeader, groupsHeader := "Remote-User", "Remote-Groups"
	if len(headers) == 2 {
		userHeader, groupsHeader = headers[0], headers[1]
	}
	if user != "" {
		r.Header.Set(userHeader, user)
	}
	if groups != "" {
		r.Header.Set(groupsHeader, groups)
	}
	return r
}

func TestProxyIdentify(t *testing.T) {
	auth, err := NewProxyAuthenticator(ProxyConfig{
		UserHeader:   "Remote-User",
		GroupsHeader: "Remote-Groups",
		RoleMapping:  RoleMapping{Admin: []string{"admins"}, Viewer: []string{"*"}},
	})
	if err != nil || auth == nil {
		t.Fatalf("NewProxyAuthenticator: %v", err)
	}

	user, err := auth.Identify(proxyRequest("lionel", "admins,family", "10.0.0.1:1234"))
	if err != nil || user.Username != "lionel" || user.Role != RoleAdmin {
		t.Fatalf("admin identify = %+v, %v", user, err)
	}

	// Known user, unmapped groups → "*" viewer.
	user, err = auth.Identify(proxyRequest("bob", "guests", "10.0.0.1:1234"))
	if err != nil || user.Role != RoleViewer {
		t.Fatalf("viewer identify = %+v, %v", user, err)
	}

	// No user header → denied.
	if _, err := auth.Identify(proxyRequest("", "", "10.0.0.1:1234")); err == nil {
		t.Error("missing user header should be denied")
	}
}

func TestProxyDenyWhenNoMatch(t *testing.T) {
	// No "*": an authenticated-but-unmapped user is denied, not viewer.
	auth, _ := NewProxyAuthenticator(ProxyConfig{
		UserHeader:   "Remote-User",
		GroupsHeader: "Remote-Groups",
		RoleMapping:  RoleMapping{Admin: []string{"admins"}},
	})
	if _, err := auth.Identify(proxyRequest("bob", "guests", "10.0.0.1:1234")); err == nil {
		t.Error("unmapped user should be denied")
	}
}

func TestProxyTrustedProxies(t *testing.T) {
	auth, err := NewProxyAuthenticator(ProxyConfig{
		UserHeader:     "Remote-User",
		RoleMapping:    RoleMapping{Viewer: []string{"*"}},
		TrustedProxies: []string{"10.0.0.0/8"},
	})
	if err != nil {
		t.Fatal(err)
	}
	if auth.TrustsAnySource() {
		t.Error("should not trust any source with a CIDR set")
	}
	// Header from a trusted peer is honored.
	if _, err := auth.Identify(proxyRequest("lionel", "", "10.1.2.3:5000")); err != nil {
		t.Errorf("trusted peer: %v", err)
	}
	// The same header from an untrusted peer is refused (spoofing guard).
	if _, err := auth.Identify(proxyRequest("lionel", "", "192.168.1.9:5000")); err == nil {
		t.Error("untrusted peer should be denied")
	}
}

func TestNoProxyWithoutUserHeader(t *testing.T) {
	auth, err := NewProxyAuthenticator(ProxyConfig{})
	if err != nil || auth != nil {
		t.Errorf("empty config should yield nil authenticator, got %v, %v", auth, err)
	}
}
