package api

import (
	"net/http"
	"strings"
	"testing"
)

// Dashboard names may carry one folder level; the {name...} wildcard must
// round-trip them through PUT, GET and DELETE.
func TestDashboardFolderRoutes(t *testing.T) {
	server := newTestServer(t, Options{})

	body := strings.Replace(validYAML, "name: node-overview", "name: db", 1)
	response := doRequest(t, http.MethodPut,
		server.URL+"/api/dashboards/infra/db", "application/yaml", body)
	if response.StatusCode != http.StatusOK {
		t.Fatalf("PUT status = %d", response.StatusCode)
	}

	response = doRequest(t, http.MethodGet, server.URL+"/api/dashboards/infra/db", "", "")
	if response.StatusCode != http.StatusOK {
		t.Fatalf("GET status = %d", response.StatusCode)
	}

	response = doRequest(t, http.MethodDelete, server.URL+"/api/dashboards/infra/db", "", "")
	if response.StatusCode != http.StatusNoContent {
		t.Fatalf("DELETE status = %d", response.StatusCode)
	}
}
