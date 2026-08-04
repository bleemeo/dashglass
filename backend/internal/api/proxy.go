package api

import (
	"context"
	"crypto/tls"
	"crypto/x509"
	"errors"
	"fmt"
	"net/http"
	"net/http/httputil"
	"net/url"
	"regexp"
	"strings"
)

// allowedProxyPaths is the read-only subset of the Prometheus HTTP API the
// UI needs: queries, metadata for PromQL autocompletion, and build info.
// Exposing the native paths keeps the frontend client and codemirror-promql
// integration trivial.
var allowedProxyPaths = regexp.MustCompile(
	`^/api/v1/(query|query_range|series|labels|label/[^/]+/values|metadata|status/buildinfo)$`,
)

// PromTLS is the TLS side of a Prometheus connection: a custom CA to
// trust (PEM), a client certificate for mTLS (PEM pair), or disabled
// verification as a last resort. Zero value = system defaults.
type PromTLS struct {
	InsecureSkipVerify bool
	CACert             []byte
	ClientCert         []byte
	ClientKey          []byte
}

func (t PromTLS) enabled() bool {
	return t.InsecureSkipVerify || len(t.CACert) > 0 ||
		len(t.ClientCert) > 0 || len(t.ClientKey) > 0
}

// promTarget is one effective Prometheus connection. The URL userinfo
// carries basic-auth credentials (never sent to the browser); bearer is
// the alternative token auth. Targets are immutable — a reconfiguration
// swaps the whole pointer.
type promTarget struct {
	url     *url.URL
	bearer  string
	headers map[string]string
	// tls keeps the raw material for persistence and the admin view;
	// transport is the ready-to-use client side built from it.
	tls       PromTLS
	transport http.RoundTripper
}

// forbiddenHeaders are request headers a datasource must not override:
// they belong to the proxy exchange itself (or are hop-by-hop), not to
// the upstream contract.
var forbiddenHeaders = map[string]bool{
	"Host":                true,
	"Cookie":              true,
	"Connection":          true,
	"Content-Length":      true,
	"Transfer-Encoding":   true,
	"Upgrade":             true,
	"Keep-Alive":          true,
	"Te":                  true,
	"Trailer":             true,
	"Proxy-Authorization": true,
	"Proxy-Connection":    true,
}

// validHeaderName reports whether name is an RFC 7230 token; net/http
// only rejects invalid names at request-write time, which would turn a
// config typo into an opaque per-request 502.
func validHeaderName(name string) bool {
	if name == "" {
		return false
	}
	for i := 0; i < len(name); i++ {
		c := name[i]
		switch {
		case c >= 'a' && c <= 'z', c >= 'A' && c <= 'Z', c >= '0' && c <= '9':
		case strings.IndexByte("!#$%&'*+-.^_`|~", c) >= 0:
		default:
			return false
		}
	}
	return true
}

// validHeaderValue rejects control characters (CR/LF injection, and
// anything net/http would refuse to write).
func validHeaderValue(value string) bool {
	for i := 0; i < len(value); i++ {
		c := value[i]
		if c < 0x20 && c != '\t' || c == 0x7f {
			return false
		}
	}
	return true
}

// newPromTarget builds an immutable target, validating the TLS material
// and the custom headers. Header names keep the user's casing (Header.Set
// canonicalizes the wire form anyway) but are checked case-insensitively:
// two case-variants of one name would race on the wire value. Every
// configuration path (yaml, state file, admin API) funnels through here.
func newPromTarget(
	u *url.URL,
	bearer string,
	headers map[string]string,
	tlsOptions PromTLS,
) (*promTarget, error) {
	seen := make(map[string]bool, len(headers))
	for name, value := range headers {
		if !validHeaderName(name) {
			return nil, fmt.Errorf("prometheus: invalid header name %q", name)
		}
		if !validHeaderValue(value) {
			return nil, fmt.Errorf("prometheus: invalid value for header %q", name)
		}
		key := http.CanonicalHeaderKey(name)
		if forbiddenHeaders[key] {
			return nil, fmt.Errorf("prometheus: header %q cannot be overridden", name)
		}
		if seen[key] {
			return nil, fmt.Errorf("prometheus: header %q is listed more than once", key)
		}
		seen[key] = true
	}
	target := &promTarget{
		url:       u,
		bearer:    bearer,
		headers:   headers,
		tls:       tlsOptions,
		transport: http.DefaultTransport,
	}
	if !tlsOptions.enabled() {
		return target, nil
	}
	tlsConfig := &tls.Config{InsecureSkipVerify: tlsOptions.InsecureSkipVerify}
	if len(tlsOptions.CACert) > 0 {
		pool := x509.NewCertPool()
		if !pool.AppendCertsFromPEM(tlsOptions.CACert) {
			return nil, errors.New("prometheus: CA certificate: no PEM certificate found")
		}
		tlsConfig.RootCAs = pool
	}
	if len(tlsOptions.ClientCert) > 0 || len(tlsOptions.ClientKey) > 0 {
		cert, err := tls.X509KeyPair(tlsOptions.ClientCert, tlsOptions.ClientKey)
		if err != nil {
			return nil, fmt.Errorf("prometheus: client certificate: %w", err)
		}
		tlsConfig.Certificates = []tls.Certificate{cert}
	}
	transport := http.DefaultTransport.(*http.Transport).Clone()
	transport.TLSClientConfig = tlsConfig
	target.transport = transport
	return target, nil
}

// authorize applies the target's custom headers and credentials to an
// outgoing request. Credentials win over a custom Authorization header;
// a custom Authorization header with auth "none" supports schemes the
// form does not know about.
func (t *promTarget) authorize(request *http.Request) {
	for name, value := range t.headers {
		request.Header.Set(name, value)
	}
	if user := t.url.User; user != nil {
		password, _ := user.Password()
		request.SetBasicAuth(user.Username(), password)
	} else if t.bearer != "" {
		request.Header.Set("Authorization", "Bearer "+t.bearer)
	}
}

// closeIdle releases the target's pooled upstream connections. Called
// when a target is replaced or was built for a one-shot probe, so
// keep-alive sockets (and a rotated-out mTLS identity) do not linger
// until the idle timeout. The shared default transport is never closed.
func (t *promTarget) closeIdle() {
	if t == nil || t.transport == http.RoundTripper(http.DefaultTransport) {
		return
	}
	if transport, ok := t.transport.(*http.Transport); ok {
		transport.CloseIdleConnections()
	}
}

// promTargetKey carries the request's target through the proxy: the
// target is captured ONCE per request (in the wrapper), so a concurrent
// admin clear/swap cannot mix two configurations mid-request or panic
// on a nil load.
type promTargetKey struct{}

func targetFrom(ctx context.Context) *promTarget {
	target, _ := ctx.Value(promTargetKey{}).(*promTarget)
	return target
}

// targetTransport routes each proxied request through the transport of
// the target captured in the request context.
type targetTransport struct{}

func (targetTransport) RoundTrip(request *http.Request) (*http.Response, error) {
	target := targetFrom(request.Context())
	if target == nil {
		// Unreachable through the wrapper; fail as a 502, not a panic.
		return nil, errors.New("no Prometheus target bound to the request")
	}
	return target.transport.RoundTrip(request)
}

// newPrometheusProxy proxies allowlisted Prometheus API calls to the
// current target — loaded once per request in the wrapper, so an admin
// reconfiguration applies to the next request without a restart while
// in-flight requests keep one coherent target. Prometheus-side
// credentials stay server-side and browser cookies never leave the
// process.
func newPrometheusProxy(load func() *promTarget) http.Handler {
	proxy := &httputil.ReverseProxy{
		Transport: targetTransport{},
		Rewrite: func(request *httputil.ProxyRequest) {
			// Same target the wrapper captured — never re-loaded.
			target := targetFrom(request.Out.Context())
			upstream := *target.url
			upstream.User = nil
			request.SetURL(&upstream)
			request.Out.Header.Del("Cookie")
			request.Out.Header.Del("Authorization")
			target.authorize(request.Out)
		},
	}

	return http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		target := load()
		if target == nil {
			writeError(writer, http.StatusServiceUnavailable,
				"no Prometheus configured (start with -prometheus-url, or set one in Admin)")
			return
		}
		if request.Method != http.MethodGet && request.Method != http.MethodPost {
			writeError(writer, http.StatusMethodNotAllowed, "only GET and POST are proxied")
			return
		}
		if !allowedProxyPaths.MatchString(request.URL.Path) {
			writeError(writer, http.StatusNotFound, "not part of the proxied Prometheus API")
			return
		}
		bound := request.WithContext(
			context.WithValue(request.Context(), promTargetKey{}, target))
		proxy.ServeHTTP(writer, bound)
	})
}
