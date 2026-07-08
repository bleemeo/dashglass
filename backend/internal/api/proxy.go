package api

import (
	"net/http"
	"net/http/httputil"
	"net/url"
	"regexp"
)

// allowedProxyPaths is the read-only subset of the Prometheus HTTP API the
// UI needs: queries, metadata for PromQL autocompletion, and build info.
// Exposing the native paths keeps the frontend client and codemirror-promql
// integration trivial.
var allowedProxyPaths = regexp.MustCompile(
	`^/api/v1/(query|query_range|series|labels|label/[^/]+/values|metadata|status/buildinfo)$`,
)

// promTarget is one effective Prometheus connection. The URL userinfo
// carries basic-auth credentials (never sent to the browser); bearer is
// the alternative token auth. Targets are immutable — a reconfiguration
// swaps the whole pointer.
type promTarget struct {
	url    *url.URL
	bearer string
}

// authorize applies the target's credentials to an outgoing request.
func (t *promTarget) authorize(request *http.Request) {
	if user := t.url.User; user != nil {
		password, _ := user.Password()
		request.SetBasicAuth(user.Username(), password)
	} else if t.bearer != "" {
		request.Header.Set("Authorization", "Bearer "+t.bearer)
	}
}

// newPrometheusProxy proxies allowlisted Prometheus API calls to the
// current target — read through load() on every request, so an admin
// reconfiguration applies without a restart. Prometheus-side credentials
// stay server-side and browser cookies never leave the process.
func newPrometheusProxy(load func() *promTarget) http.Handler {
	proxy := &httputil.ReverseProxy{
		Rewrite: func(request *httputil.ProxyRequest) {
			target := load() // non-nil: the wrapper checked before proxying
			upstream := *target.url
			upstream.User = nil
			request.SetURL(&upstream)
			request.Out.Header.Del("Cookie")
			request.Out.Header.Del("Authorization")
			target.authorize(request.Out)
		},
	}

	return http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		if load() == nil {
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
		proxy.ServeHTTP(writer, request)
	})
}
