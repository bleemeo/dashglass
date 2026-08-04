package api

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"

	"github.com/bleemeo/dashglass/backend/internal/store"
	"github.com/bleemeo/dashglass/backend/internal/watch"
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
	apiServer, err := New(options)
	if err != nil {
		t.Fatal(err)
	}
	apiServer.Routes(mux)
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

func TestPutCreateOnlyRefusesOverwrite(t *testing.T) {
	server := newTestServer(t, Options{})

	response := doRequest(t, http.MethodPut,
		server.URL+"/api/dashboards/node-overview", "application/yaml", validYAML)
	if response.StatusCode != http.StatusOK {
		t.Fatalf("PUT status = %d", response.StatusCode)
	}

	request, err := http.NewRequest(http.MethodPut,
		server.URL+"/api/dashboards/node-overview", strings.NewReader(validYAML))
	if err != nil {
		t.Fatal(err)
	}
	request.Header.Set("Content-Type", "application/yaml")
	request.Header.Set("If-None-Match", "*")
	response, err = http.DefaultClient.Do(request)
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusConflict {
		t.Fatalf("create-only PUT over existing dashboard: status = %d, want 409",
			response.StatusCode)
	}

	// A create-only PUT on a fresh name still succeeds.
	request, err = http.NewRequest(http.MethodPut,
		server.URL+"/api/dashboards/fresh", strings.NewReader(
			strings.Replace(validYAML, "node-overview", "fresh", 1)))
	if err != nil {
		t.Fatal(err)
	}
	request.Header.Set("Content-Type", "application/yaml")
	request.Header.Set("If-None-Match", "*")
	response, err = http.DefaultClient.Do(request)
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		t.Fatalf("create-only PUT on fresh name: status = %d, want 200", response.StatusCode)
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

func TestSecureRequest(t *testing.T) {
	plain := httptest.NewRequest(http.MethodGet, "/", nil)
	if secureRequest(plain) {
		t.Error("plain HTTP must not be marked secure")
	}
	forwarded := httptest.NewRequest(http.MethodGet, "/", nil)
	forwarded.Header.Set("X-Forwarded-Proto", "https")
	if !secureRequest(forwarded) {
		t.Error("X-Forwarded-Proto: https must be marked secure (TLS-terminating proxy)")
	}
}

func TestPrometheusHealth(t *testing.T) {
	decode := func(response *http.Response) struct {
		Configured bool   `json:"configured"`
		Reachable  bool   `json:"reachable"`
		Error      string `json:"error"`
	} {
		var body struct {
			Configured bool   `json:"configured"`
			Reachable  bool   `json:"reachable"`
			Error      string `json:"error"`
		}
		if err := json.NewDecoder(response.Body).Decode(&body); err != nil {
			t.Fatal(err)
		}
		return body
	}

	// Not configured.
	server := newTestServer(t, Options{})
	body := decode(doRequest(t, http.MethodGet, server.URL+"/api/prometheus/health", "", ""))
	if body.Configured || body.Reachable {
		t.Errorf("unconfigured health = %+v", body)
	}

	// Configured and answering.
	upstream := httptest.NewServer(http.HandlerFunc(
		func(writer http.ResponseWriter, _ *http.Request) {
			writer.Write([]byte(`{"status":"success","data":{"resultType":"scalar"}}`))
		}))
	defer upstream.Close()
	upstreamURL, _ := url.Parse(upstream.URL)
	up := newTestServer(t, Options{PrometheusURL: upstreamURL})
	body = decode(doRequest(t, http.MethodGet, up.URL+"/api/prometheus/health", "", ""))
	if !body.Configured || !body.Reachable {
		t.Errorf("reachable health = %+v", body)
	}

	// Configured but the target is down.
	dead, _ := url.Parse("http://127.0.0.1:0")
	down := newTestServer(t, Options{PrometheusURL: dead})
	body = decode(doRequest(t, http.MethodGet, down.URL+"/api/prometheus/health", "", ""))
	if !body.Configured || body.Reachable || body.Error == "" {
		t.Errorf("unreachable health = %+v", body)
	}
}
