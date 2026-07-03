package api

import (
	"encoding/json"
	"errors"
	"net/http"

	"github.com/bleemeo/polarisui/backend/internal/auth"
)

// anonymous is the implicit identity while authentication is disabled:
// everything is permitted, which is also what makes the no-CLI bootstrap
// possible (the admin UI is reachable to create the first user).
var anonymous = auth.User{Username: "anonymous", Role: auth.RoleAdmin}

// authenticate resolves the request identity.
func (s *Server) authenticate(r *http.Request) (auth.User, error) {
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
	if s.auth == nil || !s.auth.Enabled() {
		writeError(writer, http.StatusBadRequest, "authentication is not enabled")
		return
	}
	if s.throttle.Blocked(request) {
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
		writeError(writer, http.StatusUnauthorized, "invalid credentials")
		return
	}
	s.throttle.Success(request)
	secret, err := s.auth.SessionSecret()
	if err != nil {
		writeError(writer, http.StatusInternalServerError, err.Error())
		return
	}
	cookie, err := auth.NewSessionCookie(user, secret, request.TLS != nil)
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

func (s *Server) authMe(writer http.ResponseWriter, request *http.Request) {
	enabled := s.auth != nil && s.auth.Enabled()
	user, err := s.authenticate(request)
	if err != nil {
		writeJSON(writer, http.StatusOK, map[string]any{
			"authEnabled":   enabled,
			"authenticated": false,
		})
		return
	}
	writeJSON(writer, http.StatusOK, map[string]any{
		"authEnabled":   enabled,
		"authenticated": true,
		"username":      user.Username,
		"role":          user.Role,
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
		if setting.Secret && setting.Value != "" {
			setting.Value = "••••••••"
		}
		settings = append(settings, setting)
	}
	writeJSON(writer, http.StatusOK, settings)
}
