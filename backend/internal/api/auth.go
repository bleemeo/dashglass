package api

import (
	"encoding/json"
	"errors"
	"net/http"
	"strings"

	"github.com/bleemeo/dashglass/backend/internal/auth"
)

// anonymous is the implicit identity while authentication is disabled:
// everything is permitted, which is also what makes the no-CLI bootstrap
// possible (the admin UI is reachable to create the first user).
var anonymous = auth.User{Username: "anonymous", Role: auth.RoleAdmin}

var errUnauthenticated = errors.New("authentication required")

// secureRequest reports whether the session cookie should carry the
// Secure flag: the connection is TLS, or a proxy terminated TLS and said
// so via X-Forwarded-Proto. (A spoofed header can only make the cookie
// stricter, never leak it, so trusting it here is safe.)
func secureRequest(r *http.Request) bool {
	return r.TLS != nil ||
		strings.EqualFold(r.Header.Get("X-Forwarded-Proto"), "https")
}

// authenticate resolves the request identity. A configured reverse proxy
// is the identity source and takes precedence over local sessions; the
// headers are evaluated per request (no Dashglass session in that mode).
func (s *Server) authenticate(r *http.Request) (auth.User, error) {
	if s.proxyAuth != nil {
		return s.proxyAuth.Identify(r)
	}
	// OIDC identities live in a signed external session cookie, not the
	// local store; local users (if any also configured) still resolve
	// through the store below.
	if s.oidc != nil {
		secret, err := s.auth.SessionSecret()
		if err != nil {
			return auth.User{}, err
		}
		if user, err := auth.VerifyExternalSession(r, secret); err == nil {
			return user, nil
		}
		if s.auth.Enabled() {
			return s.auth.UserFromRequest(r, secret)
		}
		return auth.User{}, errUnauthenticated
	}
	if s.auth == nil || !s.auth.Enabled() {
		return anonymous, nil
	}
	secret, err := s.auth.SessionSecret()
	if err != nil {
		return auth.User{}, err
	}
	return s.auth.UserFromRequest(r, secret)
}

// requireRole gates a handler behind a minimum role.
func (s *Server) requireRole(required auth.Role, handler http.HandlerFunc) http.HandlerFunc {
	return func(writer http.ResponseWriter, request *http.Request) {
		user, err := s.authenticate(request)
		if err != nil {
			writeError(writer, http.StatusUnauthorized, "authentication required")
			return
		}
		if !user.Role.Allows(required) {
			writeError(writer, http.StatusForbidden,
				"this action requires the "+string(required)+" role")
			return
		}
		handler(writer, request)
	}
}

func (s *Server) authLogin(writer http.ResponseWriter, request *http.Request) {
	if s.proxyAuth != nil {
		writeError(writer, http.StatusBadRequest,
			"authentication is handled by a reverse proxy; local login is disabled")
		return
	}
	if s.auth == nil || !s.auth.Enabled() {
		writeError(writer, http.StatusBadRequest, "authentication is not enabled")
		return
	}
	if s.throttle.Blocked(request) {
		s.logger.Warn("login throttled", "remote", request.RemoteAddr)
		writeError(writer, http.StatusTooManyRequests,
			"too many failed attempts, retry in a moment")
		return
	}
	var body struct {
		Username string `json:"username"`
		Password string `json:"password"`
	}
	if err := json.NewDecoder(request.Body).Decode(&body); err != nil {
		writeError(writer, http.StatusBadRequest, "expected a JSON body")
		return
	}
	user, err := s.auth.VerifyPassword(body.Username, body.Password)
	if err != nil {
		s.throttle.Failure(request)
		s.logger.Warn("login failed",
			"username", body.Username, "remote", request.RemoteAddr)
		writeError(writer, http.StatusUnauthorized, "invalid credentials")
		return
	}
	s.throttle.Success(request)
	secret, err := s.auth.SessionSecret()
	if err != nil {
		writeError(writer, http.StatusInternalServerError, err.Error())
		return
	}
	cookie, err := auth.NewSessionCookie(user, secret, secureRequest(request))
	if err != nil {
		writeError(writer, http.StatusInternalServerError, err.Error())
		return
	}
	http.SetCookie(writer, cookie)
	writeJSON(writer, http.StatusOK, map[string]any{
		"username": user.Username,
		"role":     user.Role,
	})
}

func (s *Server) authLogout(writer http.ResponseWriter, _ *http.Request) {
	http.SetCookie(writer, auth.ClearSessionCookie())
	writer.WriteHeader(http.StatusNoContent)
}

// authLogoutAll revokes every session of the current local user by
// bumping its session version (the stateless cookies then fail to
// verify), and clears this one — a "sign out everywhere" for a lost or
// shared device.
func (s *Server) authLogoutAll(writer http.ResponseWriter, request *http.Request) {
	if s.proxyAuth != nil || s.oidc != nil || s.auth == nil || !s.auth.Enabled() {
		writeError(writer, http.StatusBadRequest,
			"sessions are managed by your identity provider")
		return
	}
	user, err := s.authenticate(request)
	if err != nil {
		writeError(writer, http.StatusUnauthorized, "authentication required")
		return
	}
	if err := s.auth.Update(user.Username, nil, nil); err != nil {
		writeError(writer, http.StatusInternalServerError, err.Error())
		return
	}
	http.SetCookie(writer, auth.ClearSessionCookie())
	writer.WriteHeader(http.StatusNoContent)
}

// authChangePassword lets a signed-in local user change their own
// password without asking an admin. The session-version bump revokes
// every outstanding session, so a fresh cookie is issued for this one.
func (s *Server) authChangePassword(writer http.ResponseWriter, request *http.Request) {
	if s.proxyAuth != nil || s.oidc != nil {
		writeError(writer, http.StatusBadRequest,
			"passwords are managed by your identity provider")
		return
	}
	if s.auth == nil || !s.auth.Enabled() {
		writeError(writer, http.StatusBadRequest, "authentication is not enabled")
		return
	}
	user, err := s.authenticate(request)
	if err != nil {
		writeError(writer, http.StatusUnauthorized, "authentication required")
		return
	}
	var body struct {
		Current string `json:"current"`
		New     string `json:"new"`
	}
	if err := json.NewDecoder(request.Body).Decode(&body); err != nil {
		writeError(writer, http.StatusBadRequest, "expected a JSON body")
		return
	}
	if _, err := s.auth.VerifyPassword(user.Username, body.Current); err != nil {
		s.logger.Warn("password change refused",
			"username", user.Username, "remote", request.RemoteAddr)
		writeError(writer, http.StatusForbidden, "current password is incorrect")
		return
	}
	if err := s.auth.Update(user.Username, nil, &body.New); err != nil {
		writeError(writer, http.StatusBadRequest, err.Error())
		return
	}
	updated, err := s.auth.Get(user.Username)
	if err != nil {
		writeError(writer, http.StatusInternalServerError, err.Error())
		return
	}
	secret, err := s.auth.SessionSecret()
	if err != nil {
		writeError(writer, http.StatusInternalServerError, err.Error())
		return
	}
	cookie, err := auth.NewSessionCookie(updated, secret, secureRequest(request))
	if err != nil {
		writeError(writer, http.StatusInternalServerError, err.Error())
		return
	}
	http.SetCookie(writer, cookie)
	writer.WriteHeader(http.StatusNoContent)
}

func (s *Server) authMe(writer http.ResponseWriter, request *http.Request) {
	enabled := s.proxyAuth != nil || s.oidc != nil ||
		(s.auth != nil && s.auth.Enabled())
	user, err := s.authenticate(request)
	if err != nil {
		writeJSON(writer, http.StatusOK, map[string]any{
			"authEnabled":   enabled,
			"authenticated": false,
			// Tells the UI not to offer a local login form.
			"proxy": s.proxyAuth != nil,
		})
		return
	}
	writeJSON(writer, http.StatusOK, map[string]any{
		"authEnabled":   enabled,
		"authenticated": true,
		"username":      user.Username,
		"role":          user.Role,
		"proxy":         s.proxyAuth != nil,
	})
}

// --- Admin: user management -------------------------------------------------

func (s *Server) adminListUsers(writer http.ResponseWriter, _ *http.Request) {
	if s.auth == nil {
		writeJSON(writer, http.StatusOK, []auth.User{})
		return
	}
	writeJSON(writer, http.StatusOK, s.auth.Users())
}

func (s *Server) adminCreateUser(writer http.ResponseWriter, request *http.Request) {
	if s.auth == nil {
		writeError(writer, http.StatusServiceUnavailable, "auth state file not configured")
		return
	}
	var body struct {
		Username string `json:"username"`
		Password string `json:"password"`
		Role     string `json:"role"`
	}
	if err := json.NewDecoder(request.Body).Decode(&body); err != nil {
		writeError(writer, http.StatusBadRequest, "expected a JSON body")
		return
	}
	role, err := auth.ParseRole(body.Role)
	if err != nil {
		writeError(writer, http.StatusBadRequest, err.Error())
		return
	}
	// The very first user must be an admin, or nobody could manage auth.
	if !s.auth.Enabled() && role != auth.RoleAdmin {
		writeError(writer, http.StatusBadRequest, "the first user must be an admin")
		return
	}
	if err := s.auth.Create(body.Username, body.Password, role); err != nil {
		writeError(writer, http.StatusBadRequest, err.Error())
		return
	}
	writeJSON(writer, http.StatusOK, map[string]any{
		"username": body.Username,
		"role":     role,
	})
}

func (s *Server) adminUpdateUser(writer http.ResponseWriter, request *http.Request) {
	if s.auth == nil {
		writeError(writer, http.StatusServiceUnavailable, "auth state file not configured")
		return
	}
	var body struct {
		Role     *string `json:"role"`
		Password *string `json:"password"`
	}
	if err := json.NewDecoder(request.Body).Decode(&body); err != nil {
		writeError(writer, http.StatusBadRequest, "expected a JSON body")
		return
	}
	var role *auth.Role
	if body.Role != nil {
		parsed, err := auth.ParseRole(*body.Role)
		if err != nil {
			writeError(writer, http.StatusBadRequest, err.Error())
			return
		}
		role = &parsed
	}
	err := s.auth.Update(request.PathValue("username"), role, body.Password)
	switch {
	case errors.Is(err, auth.ErrNotFound):
		writeError(writer, http.StatusNotFound, err.Error())
	case errors.Is(err, auth.ErrLastAdmin):
		writeError(writer, http.StatusConflict, err.Error())
	case err != nil:
		writeError(writer, http.StatusBadRequest, err.Error())
	default:
		writer.WriteHeader(http.StatusNoContent)
	}
}

func (s *Server) adminDeleteUser(writer http.ResponseWriter, request *http.Request) {
	if s.auth == nil {
		writeError(writer, http.StatusServiceUnavailable, "auth state file not configured")
		return
	}
	err := s.auth.Delete(request.PathValue("username"))
	switch {
	case errors.Is(err, auth.ErrNotFound):
		writeError(writer, http.StatusNotFound, err.Error())
	case errors.Is(err, auth.ErrLastAdmin):
		writeError(writer, http.StatusConflict, err.Error())
	case err != nil:
		writeError(writer, http.StatusBadRequest, err.Error())
	default:
		writer.WriteHeader(http.StatusNoContent)
	}
}

// --- Admin: effective configuration ------------------------------------------

// Setting is one effective configuration value with its provenance, the
// admin UI's "why isn't my setup working" debugging view.
type Setting struct {
	Key    string `json:"key"`
	Value  string `json:"value"`
	Source string `json:"source"` // default | file | env | flag
	Secret bool   `json:"secret,omitempty"`
}

func (s *Server) adminConfig(writer http.ResponseWriter, _ *http.Request) {
	settings := make([]Setting, 0, len(s.settings))
	for _, setting := range s.settings {
		// The Prometheus URL may have been set at runtime from the
		// datasource admin UI; show the live value with its provenance.
		if setting.Key == "prometheus.url" && !s.promProvisioned {
			if target := s.prom.Load(); target != nil {
				shown := *target.url
				shown.User = nil
				setting.Value = shown.String()
				setting.Source = "admin"
			}
		}
		if setting.Secret && setting.Value != "" {
			setting.Value = "••••••••"
		}
		settings = append(settings, setting)
	}
	response := map[string]any{"settings": settings}
	// Surface the (read-only) group→role mapping of whichever external
	// provider is active, so an admin can see how groups become roles.
	var mapping *auth.RoleMapping
	if s.proxyAuth != nil {
		m := s.proxyAuth.Mapping()
		mapping = &m
	} else if s.oidc != nil {
		m := s.oidc.Mapping()
		mapping = &m
	}
	if mapping != nil {
		response["roleMapping"] = map[string][]string{
			"admin":  mapping.Admin,
			"editor": mapping.Editor,
			"viewer": mapping.Viewer,
		}
	}
	writeJSON(writer, http.StatusOK, response)
}
