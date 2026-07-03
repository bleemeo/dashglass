package api

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func newFakeGrafanaCom(t *testing.T) *httptest.Server {
	t.Helper()
	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/dashboards/1860", func(writer http.ResponseWriter, _ *http.Request) {
		writeJSON(writer, http.StatusOK, map[string]any{
			"name":        "Node Exporter Full",
			"description": "A very full dashboard",
			"revision":    42,
		})
	})
	mux.HandleFunc("GET /api/dashboards/1860/revisions/42/download",
		func(writer http.ResponseWriter, _ *http.Request) {
			writeJSON(writer, http.StatusOK, map[string]any{
				"title":  "Node Exporter Full",
				"panels": []any{},
			})
		})
	server := httptest.NewServer(mux)
	t.Cleanup(server.Close)
	return server
}

func TestGrafanaComDownload(t *testing.T) {
	upstream := newFakeGrafanaCom(t)
	server := newTestServer(t, Options{GrafanaComURL: upstream.URL})

	response := doRequest(t, http.MethodGet, server.URL+"/api/grafana-com/1860", "", "")
	if response.StatusCode != http.StatusOK {
		t.Fatalf("status = %d", response.StatusCode)
	}
	var body struct {
		Dashboard   json.RawMessage `json:"dashboard"`
		Name        string          `json:"name"`
		Description string          `json:"description"`
		Revision    int             `json:"revision"`
	}
	if err := json.NewDecoder(response.Body).Decode(&body); err != nil {
		t.Fatal(err)
	}
	if body.Name != "Node Exporter Full" || body.Revision != 42 {
		t.Errorf("metadata = %+v", body)
	}
	var dashboard map[string]any
	if err := json.Unmarshal(body.Dashboard, &dashboard); err != nil {
		t.Fatal(err)
	}
	if dashboard["title"] != "Node Exporter Full" {
		t.Errorf("dashboard = %+v", dashboard)
	}
}

func TestGrafanaComDownloadRejectsNonNumericIDs(t *testing.T) {
	upstream := newFakeGrafanaCom(t)
	server := newTestServer(t, Options{GrafanaComURL: upstream.URL})

	// Anything but a plain numeric id must be rejected before any upstream
	// call — the id is the only client-controlled part of the URL (SSRF).
	for _, id := range []string{"abc", "1860x", "..%2Fadmin", "1e3"} {
		response := doRequest(t, http.MethodGet, server.URL+"/api/grafana-com/"+id, "", "")
		if response.StatusCode != http.StatusBadRequest &&
			response.StatusCode != http.StatusNotFound {
			t.Errorf("id %q: status = %d, want 400/404", id, response.StatusCode)
		}
	}
}

func TestGrafanaComDownloadDisabled(t *testing.T) {
	server := newTestServer(t, Options{}) // no GrafanaComURL

	response := doRequest(t, http.MethodGet, server.URL+"/api/grafana-com/1860", "", "")
	if response.StatusCode != http.StatusServiceUnavailable {
		t.Errorf("status = %d, want 503", response.StatusCode)
	}
}

func TestCapabilitiesExposeGrafanaComFeature(t *testing.T) {
	upstream := newFakeGrafanaCom(t)
	for _, enabled := range []bool{true, false} {
		options := Options{}
		if enabled {
			options.GrafanaComURL = upstream.URL
		}
		server := newTestServer(t, options)
		response := doRequest(t, http.MethodGet, server.URL+"/api/capabilities", "", "")
		var caps struct {
			Features map[string]bool `json:"features"`
		}
		if err := json.NewDecoder(response.Body).Decode(&caps); err != nil {
			t.Fatal(err)
		}
		if caps.Features["grafanaCom"] != enabled {
			t.Errorf("features.grafanaCom = %v, want %v", caps.Features["grafanaCom"], enabled)
		}
	}
}
