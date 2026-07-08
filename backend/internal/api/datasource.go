package api

import (
	"encoding/json"
	"net/http"
	"net/url"

	"github.com/bleemeo/dashglass/backend/internal/config"
)

// datasourceBody is the admin's datasource edit/test payload. Password
// and token are write-only: an empty value on an unchanged auth mode
// keeps the stored secret, so the URL can be edited without re-typing
// credentials.
type datasourceBody struct {
	URL      string `json:"url"`
	Auth     string `json:"auth"` // none | basic | bearer
	Username string `json:"username"`
	Password string `json:"password"`
	Token    string `json:"token"`
}

// datasourceView is the GET shape; secrets are never returned.
func (s *Server) datasourceView() map[string]any {
	target := s.prom.Load()
	view := map[string]any{
		"provisioned": s.promProvisioned,
		"editable":    !s.promProvisioned && s.stateFile != "",
		"configured":  target != nil,
	}
	if target == nil {
		return view
	}
	shown := *target.url
	shown.User = nil
	view["url"] = shown.String()
	switch {
	case target.url.User != nil:
		view["auth"] = "basic"
		view["username"] = target.url.User.Username()
	case target.bearer != "":
		view["auth"] = "bearer"
	default:
		view["auth"] = "none"
	}
	return view
}

// buildTarget validates a body into a target, inheriting the stored
// secret when the matching field is left empty.
func buildTarget(body datasourceBody, previous *promTarget) (*promTarget, error) {
	parsed, err := url.Parse(body.URL)
	if err != nil || (parsed.Scheme != "http" && parsed.Scheme != "https") || parsed.Host == "" {
		return nil, errInvalid("the URL must be http(s)://host[:port][/path]")
	}
	if parsed.User != nil {
		return nil, errInvalid("credentials go in the authentication fields, not the URL")
	}
	switch body.Auth {
	case "", "none":
		return &promTarget{url: parsed}, nil
	case "basic":
		if body.Username == "" {
			return nil, errInvalid("basic auth needs a username")
		}
		password := body.Password
		if password == "" && previous != nil && previous.url.User != nil {
			password, _ = previous.url.User.Password()
		}
		if password == "" {
			return nil, errInvalid("basic auth needs a password")
		}
		parsed.User = url.UserPassword(body.Username, password)
		return &promTarget{url: parsed}, nil
	case "bearer":
		token := body.Token
		if token == "" && previous != nil {
			token = previous.bearer
		}
		if token == "" {
			return nil, errInvalid("bearer auth needs a token")
		}
		return &promTarget{url: parsed, bearer: token}, nil
	default:
		return nil, errInvalid("auth must be none, basic or bearer")
	}
}

type invalidError string

func errInvalid(message string) error { return invalidError(message) }
func (e invalidError) Error() string  { return string(e) }

// usernameOf resolves the acting username, for the audit log lines.
func (s *Server) usernameOf(request *http.Request) string {
	user, err := s.authenticate(request)
	if err != nil {
		return "unknown"
	}
	return user.Username
}

func (s *Server) adminGetDatasource(writer http.ResponseWriter, _ *http.Request) {
	writeJSON(writer, http.StatusOK, s.datasourceView())
}

// adminPutDatasource reconfigures the Prometheus connection at runtime:
// persists to the state file, then swaps the live target. Refused when
// the URL is provisioned (flags/env/file own it — edit the deployment).
func (s *Server) adminPutDatasource(writer http.ResponseWriter, request *http.Request) {
	if s.promProvisioned {
		writeError(writer, http.StatusForbidden,
			"the Prometheus URL is provisioned (flag, env or config file); edit the deployment instead")
		return
	}
	if s.stateFile == "" {
		writeError(writer, http.StatusForbidden, "runtime settings are disabled on this instance")
		return
	}
	var body datasourceBody
	if err := json.NewDecoder(request.Body).Decode(&body); err != nil {
		writeError(writer, http.StatusBadRequest, "invalid JSON body")
		return
	}

	s.stateMu.Lock()
	defer s.stateMu.Unlock()

	// Read-modify-write: the state file holds other sections (git).
	state, err := config.LoadState(s.stateFile)
	if err != nil {
		writeError(writer, http.StatusInternalServerError, err.Error())
		return
	}

	// An empty URL clears the datasource.
	if body.URL == "" {
		state.Prometheus = config.PrometheusState{}
		if err := config.SaveState(s.stateFile, state); err != nil {
			writeError(writer, http.StatusInternalServerError, err.Error())
			return
		}
		s.prom.Store(nil)
		s.logger.Info("datasource cleared", "by", s.usernameOf(request))
		writeJSON(writer, http.StatusOK, s.datasourceView())
		return
	}

	target, err := buildTarget(body, s.prom.Load())
	if err != nil {
		writeError(writer, http.StatusBadRequest, err.Error())
		return
	}
	state.Prometheus = prometheusStateOf(target)
	if err := config.SaveState(s.stateFile, state); err != nil {
		writeError(writer, http.StatusInternalServerError, err.Error())
		return
	}
	s.prom.Store(target)
	s.logger.Info("datasource configured",
		"url", target.url.Redacted(), "by", s.usernameOf(request))
	writeJSON(writer, http.StatusOK, s.datasourceView())
}

// adminTestDatasource probes a candidate configuration without saving it.
func (s *Server) adminTestDatasource(writer http.ResponseWriter, request *http.Request) {
	var body datasourceBody
	if err := json.NewDecoder(request.Body).Decode(&body); err != nil {
		writeError(writer, http.StatusBadRequest, "invalid JSON body")
		return
	}
	target, err := buildTarget(body, s.prom.Load())
	if err != nil {
		writeError(writer, http.StatusBadRequest, err.Error())
		return
	}
	reachable, reason := probePrometheus(request.Context(), target)
	response := map[string]any{"reachable": reachable}
	if reason != "" {
		response["error"] = reason
	}
	writeJSON(writer, http.StatusOK, response)
}

// prometheusStateOf extracts the persistable form of a target.
func prometheusStateOf(target *promTarget) config.PrometheusState {
	var state config.PrometheusState
	bare := *target.url
	bare.User = nil
	state.URL = bare.String()
	if user := target.url.User; user != nil {
		state.BasicUsername = user.Username()
		state.BasicPassword, _ = user.Password()
	}
	state.BearerToken = target.bearer
	return state
}
