package api

import (
	"encoding/json"
	"net/http"
	"net/url"
	"strings"

	"github.com/bleemeo/dashglass/backend/internal/config"
)

// datasourceBody is the admin's datasource edit/test payload. Password,
// token and client key are write-only: an empty value on an unchanged
// auth mode keeps the stored secret, so the URL can be edited without
// re-typing credentials. The other fields are authoritative — sending
// them empty clears them.
type datasourceBody struct {
	URL      string `json:"url"`
	Auth     string `json:"auth"` // none | basic | bearer
	Username string `json:"username"`
	Password string `json:"password"`
	Token    string `json:"token"`
	// Extra upstream headers (e.g. X-Scope-OrgID).
	Headers map[string]string `json:"headers"`
	// TLS material, as pasted PEM. The client key is write-only: empty
	// with an unchanged client cert keeps the stored key.
	CACert             string `json:"caCert"`
	ClientCert         string `json:"clientCert"`
	ClientKey          string `json:"clientKey"`
	InsecureSkipVerify bool   `json:"insecureSkipVerify"`
}

// secretHeaderMask replaces the Authorization header value in the admin
// view: a custom auth scheme configured as an extra header is a
// credential and must not round-trip to browsers. A PUT echoing the
// mask keeps the stored value, like the other write-only secrets.
const secretHeaderMask = "(secret)"

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
	if len(target.headers) > 0 {
		// The Authorization value is masked — it is a credential.
		shown := make(map[string]string, len(target.headers))
		for name, value := range target.headers {
			if http.CanonicalHeaderKey(name) == "Authorization" {
				value = secretHeaderMask
			}
			shown[name] = value
		}
		view["headers"] = shown
	}
	// Certificates are public material and are returned so the form can
	// be edited in place; the client key never leaves the server.
	if len(target.tls.CACert) > 0 {
		view["caCert"] = string(target.tls.CACert)
	}
	if len(target.tls.ClientCert) > 0 {
		view["clientCert"] = string(target.tls.ClientCert)
	}
	view["clientKeySet"] = len(target.tls.ClientKey) > 0
	view["insecureSkipVerify"] = target.tls.InsecureSkipVerify
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

	bearer := ""
	switch body.Auth {
	case "", "none":
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
	case "bearer":
		bearer = body.Token
		if bearer == "" && previous != nil {
			bearer = previous.bearer
		}
		if bearer == "" {
			return nil, errInvalid("bearer auth needs a token")
		}
	default:
		return nil, errInvalid("auth must be none, basic or bearer")
	}

	headers := make(map[string]string)
	for rawName, rawValue := range body.Headers {
		name, value := strings.TrimSpace(rawName), strings.TrimSpace(rawValue)
		if name == "" || value == "" {
			continue
		}
		// The masked Authorization value round-trips from the view:
		// echoing it back keeps the stored credential.
		if http.CanonicalHeaderKey(name) == "Authorization" && value == secretHeaderMask {
			stored := ""
			if previous != nil {
				stored = authorizationValue(previous.headers)
			}
			if stored == "" {
				return nil, errInvalid("the Authorization header value is masked; enter it again")
			}
			value = stored
		}
		headers[name] = value
	}

	caCert := strings.TrimSpace(body.CACert)
	clientCert := strings.TrimSpace(body.ClientCert)
	clientKey := strings.TrimSpace(body.ClientKey)
	tlsOptions := PromTLS{
		InsecureSkipVerify: body.InsecureSkipVerify,
		CACert:             []byte(caCert),
		ClientCert:         []byte(clientCert),
		ClientKey:          []byte(clientKey),
	}
	// The client key is write-only: an unchanged certificate with an
	// empty key field keeps the stored key. Compare whitespace-trimmed:
	// a stored PEM's trailing newline must not defeat the rule.
	if clientCert != "" && clientKey == "" && previous != nil &&
		strings.TrimSpace(string(previous.tls.ClientCert)) == clientCert {
		tlsOptions.ClientKey = previous.tls.ClientKey
	}
	if len(tlsOptions.ClientCert) > 0 && len(tlsOptions.ClientKey) == 0 {
		return nil, errInvalid("the client certificate needs its private key")
	}
	if len(tlsOptions.ClientKey) > 0 && len(tlsOptions.ClientCert) == 0 {
		return nil, errInvalid("the client key needs its certificate")
	}

	target, err := newPromTarget(parsed, bearer, headers, tlsOptions)
	if err != nil {
		return nil, errInvalid(err.Error())
	}
	return target, nil
}

// authorizationValue finds the Authorization header regardless of the
// stored casing (names keep the user's casing).
func authorizationValue(headers map[string]string) string {
	for name, value := range headers {
		if http.CanonicalHeaderKey(name) == "Authorization" {
			return value
		}
	}
	return ""
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
		s.prom.Swap(nil).closeIdle()
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
	// Swap, then release the replaced target's pooled connections (idle
	// only — in-flight requests hold their own reference and finish).
	s.prom.Swap(target).closeIdle()
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
	// Throwaway target: do not leave its probe connection pooled.
	defer target.closeIdle()
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
	if len(target.headers) > 0 {
		state.Headers = target.headers
	}
	state.CACert = string(target.tls.CACert)
	state.ClientCert = string(target.tls.ClientCert)
	state.ClientKey = string(target.tls.ClientKey)
	state.InsecureSkipVerify = target.tls.InsecureSkipVerify
	return state
}
