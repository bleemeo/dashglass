// Package api exposes the Dashglass management API: dashboard CRUD, the
// Prometheus proxy, capabilities and the SSE event stream. This is the
// contract a SaaS backend can implement behind a façade to serve the same
// UI (see DESIGN.md §7.2).
package api

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/bleemeo/dashglass/backend/internal/auth"
	"github.com/bleemeo/dashglass/backend/internal/history"
	"github.com/bleemeo/dashglass/backend/internal/store"
	"github.com/bleemeo/dashglass/backend/internal/watch"
)

// maxDashboardSize bounds PUT bodies; dashboard files are small by nature.
const maxDashboardSize = 2 << 20

type Server struct {
	store        *store.Store
	hub          *watch.Hub
	readonly     bool
	version      string
	proxy        http.Handler
	grafanaCom   *grafanaComClient
	auth         *auth.Store
	proxyAuth    *auth.ProxyAuthenticator
	oidc         *auth.OIDCAuthenticator
	throttle     *auth.Throttle
	settings     []Setting
	logger       *slog.Logger
	history      *history.Service // nil = dashboards dir is not a git work tree
	commitOnSave bool
	// syncer keeps a git remote converged with the local repository;
	// gitProvisioned locks its config to dashglass.yaml.
	syncer         *history.Syncer
	gitProvisioned bool

	// prom is the current Prometheus connection, swappable at runtime by
	// the datasource admin API (nil = not configured). promProvisioned
	// locks it: a flag/env/file-provisioned URL is owned by the
	// deployment, not the UI. stateFile persists UI edits.
	prom            atomic.Pointer[promTarget]
	promProvisioned bool
	stateFile       string
	stateMu         sync.Mutex // serializes state-file writes
}

type Options struct {
	Store *store.Store
	Hub   *watch.Hub
	// PrometheusURL is the initial target (nil = not configured; the
	// proxy answers 503). Userinfo carries basic-auth credentials.
	PrometheusURL *url.URL
	// PrometheusBearer is the initial bearer token (state-file sourced).
	PrometheusBearer string
	// PrometheusHeaders are extra headers sent with every upstream
	// request (e.g. X-Scope-OrgID for Mimir/Cortex tenancy).
	PrometheusHeaders map[string]string
	// PrometheusTLS carries the upstream TLS options (custom CA, mTLS
	// client certificate, or disabled verification).
	PrometheusTLS PromTLS
	// PrometheusProvisioned marks the URL as flag/env/file-owned: the
	// datasource admin API then refuses runtime edits.
	PrometheusProvisioned bool
	// StateFile persists UI-managed settings (admin datasource edits);
	// empty disables them.
	StateFile string
	Readonly  bool
	Version   string
	// Base URL of the grafana.com API ("https://grafana.com" in
	// production, an httptest server in tests); empty disables the
	// marketplace import proxy.
	GrafanaComURL string
	// Auth is the server-managed user store; nil keeps the historic
	// anonymous-admin behavior with no way to enable authentication.
	Auth *auth.Store
	// ProxyAuth, when set, makes trusted reverse-proxy headers the
	// identity source (takes precedence over local sessions).
	ProxyAuth *auth.ProxyAuthenticator
	// OIDC, when set, enables native OpenID Connect login.
	OIDC *auth.OIDCAuthenticator
	// Settings is the effective configuration shown by the admin UI.
	Settings []Setting
	// Logger for auth diagnostics (failed logins, OIDC errors); defaults
	// to slog.Default().
	Logger *slog.Logger
	// History serves the read-only git history of dashboard files; nil
	// hides the feature (no git, or the directory is not a work tree).
	History *history.Service
	// CommitOnSave records every dashboard write as a git commit
	// authored by the acting user (requires History).
	CommitOnSave bool
	// Syncer pushes/pulls a git remote; nil when git is unavailable.
	Syncer *history.Syncer
	// GitProvisioned marks the remote as dashglass.yaml-owned: the git
	// admin API then refuses runtime edits.
	GitProvisioned bool
}

func New(options Options) (*Server, error) {
	server := &Server{
		store:          options.Store,
		hub:            options.Hub,
		readonly:       options.Readonly,
		version:        options.Version,
		auth:           options.Auth,
		proxyAuth:      options.ProxyAuth,
		oidc:           options.OIDC,
		throttle:       auth.NewThrottle(),
		settings:       options.Settings,
		logger:         options.Logger,
		history:        options.History,
		commitOnSave:   options.CommitOnSave && options.History != nil,
		syncer:         options.Syncer,
		gitProvisioned: options.GitProvisioned,
	}
	if server.logger == nil {
		server.logger = slog.Default()
	}
	server.promProvisioned = options.PrometheusProvisioned
	server.stateFile = options.StateFile
	if options.PrometheusURL != nil {
		target, err := newPromTarget(
			options.PrometheusURL,
			options.PrometheusBearer,
			options.PrometheusHeaders,
			options.PrometheusTLS,
		)
		switch {
		case err == nil:
			server.prom.Store(target)
		case options.PrometheusProvisioned:
			// Deployment-owned config: fail fast, the operator fixes it.
			return nil, err
		default:
			// State-file config (admin-edited): a server that boots
			// unconfigured can be fixed from the admin UI; a server that
			// refuses to boot cannot.
			server.logger.Warn("ignoring the stored Prometheus connection "+
				"(fix it in Admin → Datasource)", "error", err)
		}
	}
	server.proxy = newPrometheusProxy(server.prom.Load)
	if options.GrafanaComURL != "" {
		server.grafanaCom = newGrafanaComClient(options.GrafanaComURL)
	}
	return server, nil
}

// Routes registers the API on a mux (the caller adds the SPA handler).
// Reads need viewer, dashboard writes need editor, /api/admin needs admin;
// capabilities and the auth endpoints stay public (pre-login).
func (s *Server) Routes(mux *http.ServeMux) {
	mux.HandleFunc("GET /api/capabilities", s.capabilities)
	mux.HandleFunc("POST /api/auth/login", s.authLogin)
	mux.HandleFunc("POST /api/auth/logout", s.authLogout)
	mux.HandleFunc("POST /api/auth/logout-all", s.authLogoutAll)
	mux.HandleFunc("POST /api/auth/password", s.authChangePassword)
	mux.HandleFunc("GET /api/auth/me", s.authMe)
	mux.HandleFunc("GET /api/auth/oidc/login", s.oidcLogin)
	mux.HandleFunc("GET /api/auth/oidc/callback", s.oidcCallback)
	// {name...}: dashboard names may contain one folder level ("infra/db").
	mux.HandleFunc("GET /api/dashboards", s.requireRole(auth.RoleViewer, s.listDashboards))
	mux.HandleFunc("GET /api/dashboards/{name...}", s.requireRole(auth.RoleViewer, s.getDashboard))
	mux.HandleFunc("PUT /api/dashboards/{name...}", s.requireRole(auth.RoleEditor, s.putDashboard))
	mux.HandleFunc("DELETE /api/dashboards/{name...}", s.requireRole(auth.RoleEditor, s.deleteDashboard))
	mux.HandleFunc("GET /api/history/{name...}", s.requireRole(auth.RoleViewer, s.dashboardHistory))
	mux.HandleFunc("GET /api/prometheus/health", s.requireRole(auth.RoleViewer, s.prometheusHealth))
	mux.HandleFunc("GET /api/events", s.requireRole(auth.RoleViewer, s.events))
	mux.HandleFunc("GET /api/grafana-com/{id}", s.requireRole(auth.RoleEditor, s.grafanaComDownload))
	mux.HandleFunc("/api/v1/", s.requireRole(auth.RoleViewer, s.prometheus))
	mux.HandleFunc("GET /api/admin/users", s.requireRole(auth.RoleAdmin, s.adminListUsers))
	mux.HandleFunc("POST /api/admin/users", s.requireRole(auth.RoleAdmin, s.adminCreateUser))
	mux.HandleFunc("PATCH /api/admin/users/{username}", s.requireRole(auth.RoleAdmin, s.adminUpdateUser))
	mux.HandleFunc("DELETE /api/admin/users/{username}", s.requireRole(auth.RoleAdmin, s.adminDeleteUser))
	mux.HandleFunc("GET /api/admin/config", s.requireRole(auth.RoleAdmin, s.adminConfig))
	mux.HandleFunc("GET /api/admin/datasource", s.requireRole(auth.RoleAdmin, s.adminGetDatasource))
	mux.HandleFunc("PUT /api/admin/datasource", s.requireRole(auth.RoleAdmin, s.adminPutDatasource))
	mux.HandleFunc("POST /api/admin/datasource/test", s.requireRole(auth.RoleAdmin, s.adminTestDatasource))
	mux.HandleFunc("GET /api/admin/git", s.requireRole(auth.RoleAdmin, s.adminGetGit))
	mux.HandleFunc("PUT /api/admin/git", s.requireRole(auth.RoleAdmin, s.adminPutGit))
	mux.HandleFunc("POST /api/admin/git/test", s.requireRole(auth.RoleAdmin, s.adminTestGit))
	mux.HandleFunc("POST /api/admin/git/sync", s.requireRole(auth.RoleAdmin, s.adminSyncGit))
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
	authKind := "none"
	switch {
	case s.proxyAuth != nil:
		authKind = "proxy"
	case s.oidc != nil:
		authKind = "oidc"
	case s.auth != nil && s.auth.Enabled():
		authKind = "builtin"
	}
	writeJSON(writer, http.StatusOK, map[string]any{
		"version":    s.version,
		"readonly":   s.readonly,
		"formats":    store.Formats,
		"auth":       map[string]any{"kind": authKind},
		"prometheus": s.prom.Load() != nil,
		"features": map[string]any{
			"grafanaCom": s.grafanaCom != nil,
			"history":    s.history != nil,
		},
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
	existed := s.store.Exists(name)
	// "If-None-Match: *" makes the PUT create-only, so the UI's "new
	// dashboard" flow cannot silently overwrite an existing file.
	if request.Header.Get("If-None-Match") == "*" && existed {
		writeError(writer, http.StatusConflict,
			fmt.Sprintf("dashboard %q already exists", name))
		return
	}
	if err := s.store.Save(name, content, format); err != nil {
		var validationErr *store.ValidationError
		if errors.As(err, &validationErr) {
			writeError(writer, http.StatusBadRequest, "invalid dashboard", validationErr.Issues...)
			return
		}
		writeError(writer, http.StatusBadRequest, err.Error())
		return
	}
	if path, _, err := s.store.FilePath(name); err == nil {
		verb := "Update"
		if !existed {
			verb = "Create"
		}
		s.commitDashboard(request, path, fmt.Sprintf("%s dashboard %s", verb, name))
	}
	writeJSON(writer, http.StatusOK, map[string]any{"name": name, "format": format})
}

func (s *Server) deleteDashboard(writer http.ResponseWriter, request *http.Request) {
	if s.readonly {
		writeError(writer, http.StatusForbidden, "dashboards are provisioned read-only")
		return
	}
	name := request.PathValue("name")
	// Resolved before the delete: the path is gone afterwards.
	path, _, pathErr := s.store.FilePath(name)
	err := s.store.Delete(name)
	if errors.Is(err, store.ErrNotFound) {
		writeError(writer, http.StatusNotFound, err.Error())
		return
	}
	if err != nil {
		writeError(writer, http.StatusInternalServerError, err.Error())
		return
	}
	if pathErr == nil {
		s.commitDashboard(request, path, "Delete dashboard "+name)
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
	// The proxy itself answers 503 when no target is configured.
	s.proxy.ServeHTTP(writer, request)
}

// prometheusHealth reports whether a Prometheus is configured and, if so,
// whether it currently answers — so the UI can explain "No data" instead
// of leaving the user guessing.
func (s *Server) prometheusHealth(writer http.ResponseWriter, request *http.Request) {
	target := s.prom.Load()
	if target == nil {
		writeJSON(writer, http.StatusOK,
			map[string]any{"configured": false, "reachable": false})
		return
	}
	reachable, reason := probePrometheus(request.Context(), target)
	body := map[string]any{"configured": true, "reachable": reachable}
	if reason != "" {
		body["error"] = reason
	}
	writeJSON(writer, http.StatusOK, body)
}

// probePrometheus runs a trivial instant query ("1") against a target,
// which every Prometheus-API backend answers, with a short timeout.
func probePrometheus(ctx context.Context, target *promTarget) (bool, string) {
	probe := *target.url
	probe.Path = strings.TrimRight(probe.Path, "/") + "/api/v1/query"
	probe.RawQuery = url.Values{"query": {"1"}}.Encode()
	// Credentials travel as a header, never in the request URL.
	probe.User = nil

	ctx, cancel := context.WithTimeout(ctx, 4*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, probe.String(), nil)
	if err != nil {
		return false, err.Error()
	}
	target.authorize(req)
	client := &http.Client{Transport: target.transport}
	response, err := client.Do(req)
	if err != nil {
		return false, "cannot reach Prometheus: " + err.Error()
	}
	defer response.Body.Close()
	io.Copy(io.Discard, response.Body)
	if response.StatusCode >= 200 && response.StatusCode < 300 {
		return true, ""
	}
	return false, fmt.Sprintf("Prometheus returned HTTP %d", response.StatusCode)
}
