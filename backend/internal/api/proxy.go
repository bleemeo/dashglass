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

// newPrometheusProxy proxies allowlisted Prometheus API calls to target.
// Prometheus-side credentials stay server-side: basic auth from the target
// URL userinfo is applied here and browser cookies never leave the process.
func newPrometheusProxy(target *url.URL) http.Handler {
	user := target.User
	upstream := *target
	upstream.User = nil

	proxy := &httputil.ReverseProxy{
		Rewrite: func(request *httputil.ProxyRequest) {
			request.SetURL(&upstream)
			request.Out.Header.Del("Cookie")
			if user != nil {
				password, _ := user.Password()
				request.Out.SetBasicAuth(user.Username(), password)
			}
		},
	}

	return http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
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
