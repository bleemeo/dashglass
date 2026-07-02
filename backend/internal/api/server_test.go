package api

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"

	"github.com/bleemeo/polarisui/backend/internal/store"
	"github.com/bleemeo/polarisui/backend/internal/watch"
)

const validYAML = `
apiVersion: v1
kind: Dashboard
metadata:
  name: node-overview
spec:
  panels: {}
  layouts: []
`

func newTestServer(t *testing.T, options Options) *httptest.Server {
	t.Helper()
	if options.Store == nil {
		s, err := store.New(t.TempDir())
		if err != nil {
			t.Fatal(err)
		}
		options.Store = s
	}
	if options.Hub == nil {
		options.Hub = watch.NewHub()
	}
	mux := http.NewServeMux()
	New(options).Routes(mux)
	server := httptest.NewServer(mux)
	t.Cleanup(server.Close)
	return server
}

func doRequest(t *testing.T, method, target, contentType, body string) *http.Response {
	t.Helper()
	request, err := http.NewRequest(method, target, strings.NewReader(body))
	if err != nil {
		t.Fatal(err)
	}
	if contentType != "" {
		request.Header.Set("Content-Type", contentType)
	}
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { response.Body.Close() })
	return response
}

func TestDashboardCRUD(t *testing.T) {
	server := newTestServer(t, Options{})

	response := doRequest(t, http.MethodPut,
		server.URL+"/api/dashboards/node-overview", "application/yaml", validYAML)
	if response.StatusCode != http.StatusOK {
		t.Fatalf("PUT status = %d", response.StatusCode)
	}

	response = doRequest(t, http.MethodGet, server.URL+"/api/dashboards/node-overview", "", "")
	if response.StatusCode != http.StatusOK ||
		response.Header.Get("X-Dashboard-Format") != "yaml" {
		t.Fatalf("GET status = %d, format = %q",
			response.StatusCode, response.Header.Get("X-Dashboard-Format"))
	}

	response = doRequest(t, http.MethodGet, server.URL+"/api/dashboards", "", "")
	var infos []store.Info
	if err := json.NewDecoder(response.Body).Decode(&infos); err != nil {
		t.Fatal(err)
	}
	if len(infos) != 1 || infos[0].Name != "node-overview" {
		t.Fatalf("list = %+v", infos)
	}

	response = doRequest(t, http.MethodDelete, server.URL+"/api/dashboards/node-overview", "", "")
	if response.StatusCode != http.StatusNoContent {
		t.Fatalf("DELETE status = %d", response.StatusCode)
	}

	response = doRequest(t, http.MethodGet, server.URL+"/api/dashboards/node-overview", "", "")
	if response.StatusCode != http.StatusNotFound {
		t.Fatalf("GET after delete status = %d", response.StatusCode)
	}
}

func TestPutReportsValidationIssues(t *testing.T) {
	server := newTestServer(t, Options{})
	response := doRequest(t, http.MethodPut,
		server.URL+"/api/dashboards/node-overview", "application/yaml",
		strings.Replace(validYAML, "panels", "panelz", 1))
	if response.StatusCode != http.StatusBadRequest {
		t.Fatalf("status = %d", response.StatusCode)
	}
	var body struct {
		Error  string   `json:"error"`
		Issues []string `json:"issues"`
	}
	if err := json.NewDecoder(response.Body).Decode(&body); err != nil {
		t.Fatal(err)
	}
	if len(body.Issues) == 0 {
		t.Errorf("expected issues in response, got %+v", body)
	}
}

func TestPutRequiresKnownContentType(t *testing.T) {
	server := newTestServer(t, Options{})
	response := doRequest(t, http.MethodPut,
		server.URL+"/api/dashboards/node-overview", "text/plain", validYAML)
	if response.StatusCode != http.StatusUnsupportedMediaType {
		t.Fatalf("status = %d", response.StatusCode)
	}
}

func TestReadonlyMode(t *testing.T) {
	server := newTestServer(t, Options{Readonly: true})
	response := doRequest(t, http.MethodPut,
		server.URL+"/api/dashboards/node-overview", "application/yaml", validYAML)
	if response.StatusCode != http.StatusForbidden {
		t.Fatalf("PUT status = %d, want 403", response.StatusCode)
	}
	response = doRequest(t, http.MethodDelete, server.URL+"/api/dashboards/x", "", "")
	if response.StatusCode != http.StatusForbidden {
		t.Fatalf("DELETE status = %d, want 403", response.StatusCode)
	}
}

func TestCapabilities(t *testing.T) {
	server := newTestServer(t, Options{Readonly: true, Version: "test"})
	response := doRequest(t, http.MethodGet, server.URL+"/api/capabilities", "", "")
	var caps struct {
		Version    string   `json:"version"`
		Readonly   bool     `json:"readonly"`
		Formats    []string `json:"formats"`
		Prometheus bool     `json:"prometheus"`
	}
	if err := json.NewDecoder(response.Body).Decode(&caps); err != nil {
		t.Fatal(err)
	}
	if caps.Version != "test" || !caps.Readonly || len(caps.Formats) != 3 || caps.Prometheus {
		t.Errorf("capabilities = %+v", caps)
	}
}

func TestPrometheusProxy(t *testing.T) {
	var seenPath, seenAuth string
	upstream := httptest.NewServer(http.HandlerFunc(
		func(writer http.ResponseWriter, request *http.Request) {
			seenPath = request.URL.Path
			seenAuth = request.Header.Get("Authorization")
			writer.Write([]byte(`{"status":"success"}`))
		}))
	defer upstream.Close()

	upstreamURL, _ := url.Parse(upstream.URL)
	upstreamURL.User = url.UserPassword("user", "secret")
	server := newTestServer(t, Options{PrometheusURL: upstreamURL})

	response := doRequest(t, http.MethodGet,
		server.URL+"/api/v1/query_range?query=up&start=0&end=1&step=15", "", "")
	if response.StatusCode != http.StatusOK {
		t.Fatalf("proxied query status = %d", response.StatusCode)
	}
	if seenPath != "/api/v1/query_range" {
		t.Errorf("upstream path = %q", seenPath)
	}
	if !strings.HasPrefix(seenAuth, "Basic ") {
		t.Errorf("upstream should receive basic auth from URL userinfo, got %q", seenAuth)
	}

	response = doRequest(t, http.MethodGet, server.URL+"/api/v1/label/instance/values", "", "")
	if response.StatusCode != http.StatusOK {
		t.Errorf("label values status = %d", response.StatusCode)
	}

	// Write/admin endpoints must not be reachable through the proxy.
	response = doRequest(t, http.MethodPost, server.URL+"/api/v1/admin/tsdb/delete_series", "", "")
	if response.StatusCode != http.StatusNotFound {
		t.Errorf("admin endpoint status = %d, want 404", response.StatusCode)
	}
	response = doRequest(t, http.MethodDelete, server.URL+"/api/v1/query", "", "")
	if response.StatusCode != http.StatusMethodNotAllowed {
		t.Errorf("DELETE status = %d, want 405", response.StatusCode)
	}
}

func TestProxyUnconfigured(t *testing.T) {
	server := newTestServer(t, Options{})
	response := doRequest(t, http.MethodGet, server.URL+"/api/v1/query?query=up", "", "")
	if response.StatusCode != http.StatusServiceUnavailable {
		t.Errorf("status = %d, want 503", response.StatusCode)
	}
}
