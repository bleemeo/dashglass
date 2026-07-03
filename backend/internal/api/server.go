// Package api exposes the Polaris management API: dashboard CRUD, the
// Prometheus proxy, capabilities and the SSE event stream. This is the
// contract a SaaS backend can implement behind a façade to serve the same
// UI (see DESIGN.md §7.2).
package api

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"time"

	"github.com/bleemeo/polarisui/backend/internal/store"
	"github.com/bleemeo/polarisui/backend/internal/watch"
)

// maxDashboardSize bounds PUT bodies; dashboard files are small by nature.
const maxDashboardSize = 2 << 20

type Server struct {
	store      *store.Store
	hub        *watch.Hub
	readonly   bool
	version    string
	proxy      http.Handler
	grafanaCom *grafanaComClient
}

type Options struct {
	Store         *store.Store
	Hub           *watch.Hub
	PrometheusURL *url.URL // nil disables the proxy (503)
	Readonly      bool
	Version       string
	// Base URL of the grafana.com API ("https://grafana.com" in
	// production, an httptest server in tests); empty disables the
	// marketplace import proxy.
	GrafanaComURL string
}

func New(options Options) *Server {
	server := &Server{
		store:    options.Store,
		hub:      options.Hub,
		readonly: options.Readonly,
		version:  options.Version,
	}
	if options.PrometheusURL != nil {
		server.proxy = newPrometheusProxy(options.PrometheusURL)
	}
	if options.GrafanaComURL != "" {
		server.grafanaCom = newGrafanaComClient(options.GrafanaComURL)
	}
	return server
}

// Routes registers the API on a mux (the caller adds the SPA handler).
func (s *Server) Routes(mux *http.ServeMux) {
	mux.HandleFunc("GET /api/capabilities", s.capabilities)
	mux.HandleFunc("GET /api/dashboards", s.listDashboards)
	mux.HandleFunc("GET /api/dashboards/{name}", s.getDashboard)
	mux.HandleFunc("PUT /api/dashboards/{name}", s.putDashboard)
	mux.HandleFunc("DELETE /api/dashboards/{name}", s.deleteDashboard)
	mux.HandleFunc("GET /api/events", s.events)
	mux.HandleFunc("GET /api/grafana-com/{id}", s.grafanaComDownload)
	mux.HandleFunc("/api/v1/", s.prometheus)
}

func writeJSON(writer http.ResponseWriter, status int, value any) {
	writer.Header().Set("Content-Type", "application/json")
	writer.WriteHeader(status)
	json.NewEncoder(writer).Encode(value)
}

func writeError(writer http.ResponseWriter, status int, message string, issues ...string) {
	body := map[string]any{"error": message}
	if len(issues) > 0 {
		body["issues"] = issues
	}
	writeJSON(writer, status, body)
}

// capabilities tells the UI what this backend supports; the SaaS backend
// returns a richer profile through the same endpoint (DESIGN.md §7.3).
func (s *Server) capabilities(writer http.ResponseWriter, _ *http.Request) {
	writeJSON(writer, http.StatusOK, map[string]any{
		"version":    s.version,
		"readonly":   s.readonly,
		"formats":    store.Formats,
		"auth":       map[string]any{"kind": "none"},
		"prometheus": s.proxy != nil,
		"features":   map[string]any{"grafanaCom": s.grafanaCom != nil},
	})
}

func (s *Server) listDashboards(writer http.ResponseWriter, _ *http.Request) {
	infos, err := s.store.List()
	if err != nil {
		writeError(writer, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(writer, http.StatusOK, infos)
}

func (s *Server) getDashboard(writer http.ResponseWriter, request *http.Request) {
	content, format, err := s.store.Get(request.PathValue("name"))
	if errors.Is(err, store.ErrNotFound) {
		writeError(writer, http.StatusNotFound, err.Error())
		return
	}
	if err != nil {
		writeError(writer, http.StatusInternalServerError, err.Error())
		return
	}
	writer.Header().Set("Content-Type", format.ContentType())
	writer.Header().Set("X-Dashboard-Format", string(format))
	writer.Write(content)
}

// putDashboard accepts the raw file content: canonical serialization is
// owned by the UI (packages/model), the backend validates and persists.
func (s *Server) putDashboard(writer http.ResponseWriter, request *http.Request) {
	if s.readonly {
		writeError(writer, http.StatusForbidden, "dashboards are provisioned read-only")
		return
	}
	format, ok := store.FormatForContentType(request.Header.Get("Content-Type"))
	if !ok {
		writeError(writer, http.StatusUnsupportedMediaType,
			"set Content-Type to application/json, application/yaml or application/toml")
		return
	}
	content, err := io.ReadAll(http.MaxBytesReader(writer, request.Body, maxDashboardSize))
	if err != nil {
		writeError(writer, http.StatusBadRequest, err.Error())
		return
	}

	name := request.PathValue("name")
	if err := s.store.Save(name, content, format); err != nil {
		var validationErr *store.ValidationError
		if errors.As(err, &validationErr) {
			writeError(writer, http.StatusBadRequest, "invalid dashboard", validationErr.Issues...)
			return
		}
		writeError(writer, http.StatusBadRequest, err.Error())
		return
	}
	writeJSON(writer, http.StatusOK, map[string]any{"name": name, "format": format})
}

func (s *Server) deleteDashboard(writer http.ResponseWriter, request *http.Request) {
	if s.readonly {
		writeError(writer, http.StatusForbidden, "dashboards are provisioned read-only")
		return
	}
	err := s.store.Delete(request.PathValue("name"))
	if errors.Is(err, store.ErrNotFound) {
		writeError(writer, http.StatusNotFound, err.Error())
		return
	}
	if err != nil {
		writeError(writer, http.StatusInternalServerError, err.Error())
		return
	}
	writer.WriteHeader(http.StatusNoContent)
}

// events streams dashboard file changes over SSE.
func (s *Server) events(writer http.ResponseWriter, request *http.Request) {
	flusher, ok := writer.(http.Flusher)
	if !ok {
		writeError(writer, http.StatusInternalServerError, "streaming unsupported")
		return
	}
	writer.Header().Set("Content-Type", "text/event-stream")
	writer.Header().Set("Cache-Control", "no-cache")
	writer.WriteHeader(http.StatusOK)
	flusher.Flush()

	eventsCh, unsubscribe := s.hub.Subscribe()
	defer unsubscribe()

	keepAlive := time.NewTicker(30 * time.Second)
	defer keepAlive.Stop()

	for {
		select {
		case <-request.Context().Done():
			return
		case <-keepAlive.C:
			fmt.Fprint(writer, ": keep-alive\n\n")
			flusher.Flush()
		case event := <-eventsCh:
			payload, err := json.Marshal(event)
			if err != nil {
				continue
			}
			fmt.Fprintf(writer, "data: %s\n\n", payload)
			flusher.Flush()
		}
	}
}

func (s *Server) prometheus(writer http.ResponseWriter, request *http.Request) {
	if s.proxy == nil {
		writeError(writer, http.StatusServiceUnavailable,
			"no Prometheus configured (start with -prometheus-url)")
		return
	}
	s.proxy.ServeHTTP(writer, request)
}
