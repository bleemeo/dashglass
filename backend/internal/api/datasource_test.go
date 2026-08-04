package api

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/bleemeo/dashglass/backend/internal/config"
)

// fakePrometheus records the Authorization header of the last request.
func fakePrometheus(t *testing.T) (*httptest.Server, *string) {
	t.Helper()
	var lastAuth string
	upstream := httptest.NewServer(http.HandlerFunc(
		func(writer http.ResponseWriter, request *http.Request) {
			lastAuth = request.Header.Get("Authorization")
			writer.Write([]byte(`{"status":"success"}`))
		}))
	t.Cleanup(upstream.Close)
	return upstream, &lastAuth
}

func getDatasource(t *testing.T, base string) map[string]any {
	t.Helper()
	response := doRequest(t, http.MethodGet, base+"/api/admin/datasource", "", "")
	if response.StatusCode != http.StatusOK {
		t.Fatalf("GET datasource status = %d", response.StatusCode)
	}
	var view map[string]any
	if err := json.NewDecoder(response.Body).Decode(&view); err != nil {
		t.Fatal(err)
	}
	return view
}

func TestDatasourceConfigure(t *testing.T) {
	upstream, lastAuth := fakePrometheus(t)
	stateFile := filepath.Join(t.TempDir(), "settings.yaml")
	server := newTestServer(t, Options{StateFile: stateFile})

	// Fresh instance: editable, not configured; the proxy answers 503.
	view := getDatasource(t, server.URL)
	if view["editable"] != true || view["configured"] != false {
		t.Fatalf("initial view = %v", view)
	}
	response := doRequest(t, http.MethodGet, server.URL+"/api/v1/query?query=1", "", "")
	if response.StatusCode != http.StatusServiceUnavailable {
		t.Fatalf("unconfigured proxy status = %d, want 503", response.StatusCode)
	}

	// Configure with bearer auth: live swap, no restart.
	response = doRequest(t, http.MethodPut, server.URL+"/api/admin/datasource",
		"application/json",
		`{"url":"`+upstream.URL+`","auth":"bearer","token":"tok-1"}`)
	if response.StatusCode != http.StatusOK {
		t.Fatalf("PUT status = %d", response.StatusCode)
	}
	response = doRequest(t, http.MethodGet, server.URL+"/api/v1/query?query=1", "", "")
	if response.StatusCode != http.StatusOK {
		t.Fatalf("configured proxy status = %d", response.StatusCode)
	}
	if *lastAuth != "Bearer tok-1" {
		t.Fatalf("upstream auth = %q, want the bearer token", *lastAuth)
	}

	// The view exposes the mode but never the secret.
	view = getDatasource(t, server.URL)
	if view["auth"] != "bearer" || view["configured"] != true {
		t.Fatalf("view = %v", view)
	}
	if raw, _ := json.Marshal(view); strings.Contains(string(raw), "tok-1") {
		t.Fatal("secret leaked in the datasource view")
	}

	// Persisted owner-only, and reloadable.
	info, err := os.Stat(stateFile)
	if err != nil {
		t.Fatal(err)
	}
	if info.Mode().Perm() != 0o600 {
		t.Fatalf("state file mode = %v, want 0600", info.Mode().Perm())
	}
	state, err := config.LoadState(stateFile)
	if err != nil {
		t.Fatal(err)
	}
	if state.Prometheus.URL != upstream.URL || state.Prometheus.BearerToken != "tok-1" {
		t.Fatalf("persisted state = %+v", state.Prometheus)
	}

	// Clearing unconfigures and empties the state file.
	response = doRequest(t, http.MethodPut, server.URL+"/api/admin/datasource",
		"application/json", `{"url":""}`)
	if response.StatusCode != http.StatusOK {
		t.Fatalf("clear status = %d", response.StatusCode)
	}
	response = doRequest(t, http.MethodGet, server.URL+"/api/v1/query?query=1", "", "")
	if response.StatusCode != http.StatusServiceUnavailable {
		t.Fatalf("cleared proxy status = %d, want 503", response.StatusCode)
	}
}

func TestDatasourceKeepsSecretOnEdit(t *testing.T) {
	upstream, lastAuth := fakePrometheus(t)
	stateFile := filepath.Join(t.TempDir(), "settings.yaml")
	server := newTestServer(t, Options{StateFile: stateFile})

	response := doRequest(t, http.MethodPut, server.URL+"/api/admin/datasource",
		"application/json",
		`{"url":"`+upstream.URL+`","auth":"basic","username":"prom","password":"s3cret"}`)
	if response.StatusCode != http.StatusOK {
		t.Fatalf("PUT status = %d", response.StatusCode)
	}

	// Edit the URL only (same auth, empty password): the secret is kept.
	response = doRequest(t, http.MethodPut, server.URL+"/api/admin/datasource",
		"application/json",
		`{"url":"`+upstream.URL+`/","auth":"basic","username":"prom","password":""}`)
	if response.StatusCode != http.StatusOK {
		t.Fatalf("re-PUT status = %d", response.StatusCode)
	}
	doRequest(t, http.MethodGet, server.URL+"/api/v1/query?query=1", "", "")
	user, pass, _ := parseBasic(*lastAuth)
	if user != "prom" || pass != "s3cret" {
		t.Fatalf("upstream basic auth = %q/%q, want the kept secret", user, pass)
	}
}

func parseBasic(header string) (string, string, bool) {
	request := &http.Request{Header: http.Header{"Authorization": {header}}}
	return request.BasicAuth()
}

func TestDatasourceProvisionedIsLocked(t *testing.T) {
	upstreamURL, _ := url.Parse("http://prometheus.internal:9090")
	server := newTestServer(t, Options{
		PrometheusURL:         upstreamURL,
		PrometheusProvisioned: true,
		StateFile:             filepath.Join(t.TempDir(), "settings.yaml"),
	})

	view := getDatasource(t, server.URL)
	if view["provisioned"] != true || view["editable"] != false {
		t.Fatalf("view = %v", view)
	}
	response := doRequest(t, http.MethodPut, server.URL+"/api/admin/datasource",
		"application/json", `{"url":"http://elsewhere:9090"}`)
	if response.StatusCode != http.StatusForbidden {
		t.Fatalf("PUT on provisioned status = %d, want 403", response.StatusCode)
	}
}

func TestDatasourceTest(t *testing.T) {
	upstream, lastAuth := fakePrometheus(t)
	server := newTestServer(t, Options{StateFile: filepath.Join(t.TempDir(), "settings.yaml")})

	// A reachable candidate — probed with its credentials, not saved.
	response := doRequest(t, http.MethodPost, server.URL+"/api/admin/datasource/test",
		"application/json",
		`{"url":"`+upstream.URL+`","auth":"bearer","token":"probe-tok"}`)
	if response.StatusCode != http.StatusOK {
		t.Fatalf("test status = %d", response.StatusCode)
	}
	var result map[string]any
	if err := json.NewDecoder(response.Body).Decode(&result); err != nil {
		t.Fatal(err)
	}
	if result["reachable"] != true {
		t.Fatalf("test result = %v", result)
	}
	if *lastAuth != "Bearer probe-tok" {
		t.Fatalf("probe auth = %q", *lastAuth)
	}
	if view := getDatasource(t, server.URL); view["configured"] != false {
		t.Fatal("test must not save the configuration")
	}

	// Invalid URL → 400.
	response = doRequest(t, http.MethodPost, server.URL+"/api/admin/datasource/test",
		"application/json", `{"url":"ftp://nope"}`)
	if response.StatusCode != http.StatusBadRequest {
		t.Fatalf("bad URL test status = %d, want 400", response.StatusCode)
	}
}

func TestDatasourceHeadersAndTLSRoundTrip(t *testing.T) {
	var lastTenant string
	upstream := httptest.NewServer(http.HandlerFunc(
		func(writer http.ResponseWriter, request *http.Request) {
			lastTenant = request.Header.Get("X-Scope-OrgID")
			writer.Write([]byte(`{"status":"success"}`))
		}))
	t.Cleanup(upstream.Close)
	stateFile := filepath.Join(t.TempDir(), "settings.yaml")
	server := newTestServer(t, Options{StateFile: stateFile})

	certPEM, keyPEM := selfSignedPair(t)
	body, err := json.Marshal(map[string]any{
		"url":                upstream.URL,
		"auth":               "none",
		"headers":            map[string]string{"X-Scope-OrgID": "tenant-42"},
		"caCert":             string(certPEM),
		"clientCert":         string(certPEM),
		"clientKey":          string(keyPEM),
		"insecureSkipVerify": true,
	})
	if err != nil {
		t.Fatal(err)
	}
	response := doRequest(t, http.MethodPut, server.URL+"/api/admin/datasource",
		"application/json", string(body))
	if response.StatusCode != http.StatusOK {
		t.Fatalf("PUT status = %d", response.StatusCode)
	}

	// The proxy forwards the tenancy header.
	doRequest(t, http.MethodGet, server.URL+"/api/v1/query?query=1", "", "")
	if lastTenant != "tenant-42" {
		t.Fatalf("upstream X-Scope-OrgID = %q, want tenant-42", lastTenant)
	}

	// The view exposes everything except the client key.
	view := getDatasource(t, server.URL)
	if view["insecureSkipVerify"] != true || view["clientKeySet"] != true {
		t.Fatalf("view = %v", view)
	}
	// PEMs are whitespace-trimmed on intake (canonical stored form).
	if view["clientCert"] != strings.TrimSpace(string(certPEM)) {
		t.Fatal("client certificate not returned by the view")
	}
	if _, leaked := view["clientKey"]; leaked {
		t.Fatal("the client key must never be returned")
	}

	// Everything is persisted for the next restart.
	state, err := config.LoadState(stateFile)
	if err != nil {
		t.Fatal(err)
	}
	if state.Prometheus.Headers["X-Scope-OrgID"] != "tenant-42" ||
		state.Prometheus.ClientKey != strings.TrimSpace(string(keyPEM)) ||
		!state.Prometheus.InsecureSkipVerify {
		t.Fatalf("state not persisted: %+v", state.Prometheus)
	}

	// Editing with an unchanged cert and an empty key keeps the stored key.
	edited, _ := json.Marshal(map[string]any{
		"url":        upstream.URL,
		"auth":       "none",
		"clientCert": string(certPEM),
		"clientKey":  "",
	})
	response = doRequest(t, http.MethodPut, server.URL+"/api/admin/datasource",
		"application/json", string(edited))
	if response.StatusCode != http.StatusOK {
		t.Fatalf("re-PUT status = %d", response.StatusCode)
	}
	state, err = config.LoadState(stateFile)
	if err != nil {
		t.Fatal(err)
	}
	if state.Prometheus.ClientKey != strings.TrimSpace(string(keyPEM)) {
		t.Fatal("stored client key lost on edit")
	}
	// Headers were omitted from the edit body: they are authoritative
	// fields, so they are now cleared.
	if len(state.Prometheus.Headers) != 0 {
		t.Fatalf("headers should be cleared, got %v", state.Prometheus.Headers)
	}
}

func TestDatasourceMasksAuthorizationHeader(t *testing.T) {
	upstream, lastAuth := fakePrometheus(t)
	stateFile := filepath.Join(t.TempDir(), "settings.yaml")
	server := newTestServer(t, Options{StateFile: stateFile})

	// Configure a custom Authorization scheme as an extra header.
	response := doRequest(t, http.MethodPut, server.URL+"/api/admin/datasource",
		"application/json",
		`{"url":"`+upstream.URL+`","auth":"none","headers":{"Authorization":"ApiKey s3cret"}}`)
	if response.StatusCode != http.StatusOK {
		t.Fatalf("PUT status = %d", response.StatusCode)
	}

	// The view masks the value; it never round-trips to browsers.
	view := getDatasource(t, server.URL)
	headers, _ := view["headers"].(map[string]any)
	if headers["Authorization"] != "(secret)" {
		t.Fatalf("Authorization not masked in the view: %v", headers)
	}

	// Echoing the mask back (what the form does) keeps the stored value.
	response = doRequest(t, http.MethodPut, server.URL+"/api/admin/datasource",
		"application/json",
		`{"url":"`+upstream.URL+`","auth":"none","headers":{"Authorization":"(secret)"}}`)
	if response.StatusCode != http.StatusOK {
		t.Fatalf("re-PUT status = %d", response.StatusCode)
	}
	doRequest(t, http.MethodGet, server.URL+"/api/v1/query?query=1", "", "")
	if *lastAuth != "ApiKey s3cret" {
		t.Fatalf("upstream Authorization = %q, want the kept secret", *lastAuth)
	}

	// The mask with nothing stored is refused, not saved literally.
	fresh := newTestServer(t, Options{StateFile: filepath.Join(t.TempDir(), "s.yaml")})
	response = doRequest(t, http.MethodPut, fresh.URL+"/api/admin/datasource",
		"application/json",
		`{"url":"`+upstream.URL+`","auth":"none","headers":{"Authorization":"(secret)"}}`)
	if response.StatusCode != http.StatusBadRequest {
		t.Fatalf("mask without a stored value: status = %d, want 400", response.StatusCode)
	}
}
