package api

import (
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/url"

	"github.com/bleemeo/dashglass/backend/internal/auth"
)

const oidcFlowCookie = "dashglass_oidc_flow"

// oidcLogin starts the authorization-code flow: it stashes the flow
// secrets (state, nonce, PKCE verifier) in a short-lived signed cookie and
// redirects the browser to the provider.
func (s *Server) oidcLogin(writer http.ResponseWriter, request *http.Request) {
	if s.oidc == nil {
		writeError(writer, http.StatusNotFound, "OIDC is not configured")
		return
	}
	authURL, flow := s.oidc.Start()
	secret, err := s.auth.SessionSecret()
	if err != nil {
		writeError(writer, http.StatusInternalServerError, err.Error())
		return
	}
	payload, _ := json.Marshal(flow)
	http.SetCookie(writer, &http.Cookie{
		Name:     oidcFlowCookie,
		Value:    signValue(payload, secret),
		Path:     "/api/auth/oidc",
		HttpOnly: true,
		Secure:   secureRequest(request),
		SameSite: http.SameSiteLaxMode,
		MaxAge:   int(auth.FlowCookieTTL.Seconds()),
	})
	http.Redirect(writer, request, authURL, http.StatusFound)
}

// oidcCallback finishes the flow: verifies the flow cookie, exchanges the
// code, maps the identity to a role and issues the app session cookie.
func (s *Server) oidcCallback(writer http.ResponseWriter, request *http.Request) {
	if s.oidc == nil {
		writeError(writer, http.StatusNotFound, "OIDC is not configured")
		return
	}
	secret, err := s.auth.SessionSecret()
	if err != nil {
		s.oidcFail(writer, request, "server error")
		return
	}
	cookie, err := request.Cookie(oidcFlowCookie)
	if err != nil {
		s.oidcFail(writer, request, "login expired, please try again")
		return
	}
	payload, ok := verifyValue(cookie.Value, secret)
	if !ok {
		s.oidcFail(writer, request, "invalid login state")
		return
	}
	var flow auth.OIDCFlow
	if err := json.Unmarshal(payload, &flow); err != nil {
		s.oidcFail(writer, request, "invalid login state")
		return
	}
	// Clear the flow cookie regardless of outcome.
	http.SetCookie(writer, &http.Cookie{Name: oidcFlowCookie, Path: "/api/auth/oidc", MaxAge: -1})

	user, err := s.oidc.Complete(request.Context(), request, flow)
	if err != nil {
		// The browser only gets a generic reason; the detail (bad token,
		// unmapped groups, …) is for the operator's log.
		s.logger.Warn("oidc login failed", "error", err)
		s.oidcFail(writer, request, "access denied")
		return
	}
	session, err := auth.NewExternalSessionCookie(user.Username, user.Role, secret, secureRequest(request))
	if err != nil {
		s.oidcFail(writer, request, "server error")
		return
	}
	http.SetCookie(writer, session)
	http.Redirect(writer, request, "/", http.StatusFound)
}

// oidcFail redirects back to the login page with a short reason.
func (s *Server) oidcFail(writer http.ResponseWriter, request *http.Request, reason string) {
	http.Redirect(writer, request,
		"/login?error="+url.QueryEscape(reason), http.StatusFound)
}

// signValue / verifyValue sign a short-lived cookie payload with the
// session secret (same HMAC scheme as sessions), for the OIDC flow cookie.
func signValue(payload, secret []byte) string {
	encoded := base64.RawURLEncoding.EncodeToString(payload)
	return encoded + "." + auth.SignPayload(payload, secret)
}

func verifyValue(value string, secret []byte) ([]byte, bool) {
	return auth.VerifySignedValue(value, secret)
}
