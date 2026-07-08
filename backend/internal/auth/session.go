package auth

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"time"
)

const (
	// SessionCookie is the session cookie name.
	SessionCookie = "dashglass_session"
	sessionTTL    = 7 * 24 * time.Hour
)

type sessionClaims struct {
	Username string `json:"u"`
	Version  int    `json:"v"`
	Expires  int64  `json:"e"`
	// External sessions (OIDC) are not backed by a local user record, so
	// they carry their role and skip the store lookup / version check.
	External bool `json:"x,omitempty"`
	Role     Role `json:"r,omitempty"`
}

// A local-user cookie carries username + version and the role is resolved
// from the store (so role changes apply immediately); an external (OIDC)
// cookie carries the role directly, re-derived at each login.

func sign(payload []byte, secret []byte) string {
	mac := hmac.New(sha256.New, secret)
	mac.Write(payload)
	return base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
}

// SignPayload is the exported HMAC used for short-lived signed cookies
// (the OIDC flow cookie); same scheme as session cookies.
func SignPayload(payload, secret []byte) string {
	return sign(payload, secret)
}

// VerifySignedValue checks a "<base64 payload>.<sig>" value and returns the
// decoded payload when the signature is valid.
func VerifySignedValue(value string, secret []byte) ([]byte, bool) {
	encoded, signature, found := strings.Cut(value, ".")
	if !found {
		return nil, false
	}
	payload, err := base64.RawURLEncoding.DecodeString(encoded)
	if err != nil {
		return nil, false
	}
	if !hmac.Equal([]byte(sign(payload, secret)), []byte(signature)) {
		return nil, false
	}
	return payload, true
}

// NewSessionCookie builds a signed session cookie for a user.
func NewSessionCookie(user User, secret []byte, secure bool) (*http.Cookie, error) {
	claims := sessionClaims{
		Username: user.Username,
		Version:  user.SessionVersion,
		Expires:  time.Now().Add(sessionTTL).Unix(),
	}
	payload, err := json.Marshal(claims)
	if err != nil {
		return nil, err
	}
	encoded := base64.RawURLEncoding.EncodeToString(payload)
	return &http.Cookie{
		Name:     SessionCookie,
		Value:    encoded + "." + sign(payload, secret),
		Path:     "/",
		HttpOnly: true,
		Secure:   secure,
		SameSite: http.SameSiteLaxMode,
		MaxAge:   int(sessionTTL.Seconds()),
	}, nil
}

// NewExternalSessionCookie builds a session for an identity resolved by an
// external provider (OIDC): the role is embedded, there is no local record.
func NewExternalSessionCookie(username string, role Role, secret []byte, secure bool) (*http.Cookie, error) {
	claims := sessionClaims{
		Username: username,
		External: true,
		Role:     role,
		Expires:  time.Now().Add(sessionTTL).Unix(),
	}
	payload, err := json.Marshal(claims)
	if err != nil {
		return nil, err
	}
	encoded := base64.RawURLEncoding.EncodeToString(payload)
	return &http.Cookie{
		Name:     SessionCookie,
		Value:    encoded + "." + sign(payload, secret),
		Path:     "/",
		HttpOnly: true,
		Secure:   secure,
		SameSite: http.SameSiteLaxMode,
		MaxAge:   int(sessionTTL.Seconds()),
	}, nil
}

// ClearSessionCookie expires the session cookie.
func ClearSessionCookie() *http.Cookie {
	return &http.Cookie{
		Name:     SessionCookie,
		Value:    "",
		Path:     "/",
		HttpOnly: true,
		SameSite: http.SameSiteLaxMode,
		MaxAge:   -1,
	}
}

var errInvalidSession = errors.New("invalid session")

// UserFromRequest resolves the session cookie to a live user: signature,
// expiry and session version must all check out.
func (s *Store) UserFromRequest(r *http.Request, secret []byte) (User, error) {
	cookie, err := r.Cookie(SessionCookie)
	if err != nil {
		return User{}, errInvalidSession
	}
	encoded, signature, found := strings.Cut(cookie.Value, ".")
	if !found {
		return User{}, errInvalidSession
	}
	payload, err := base64.RawURLEncoding.DecodeString(encoded)
	if err != nil {
		return User{}, errInvalidSession
	}
	if !hmac.Equal([]byte(sign(payload, secret)), []byte(signature)) {
		return User{}, errInvalidSession
	}
	var claims sessionClaims
	if err := json.Unmarshal(payload, &claims); err != nil {
		return User{}, errInvalidSession
	}
	if time.Now().Unix() > claims.Expires {
		return User{}, errInvalidSession
	}
	if claims.External {
		// OIDC identity: role travels in the (signed) cookie.
		return User{Username: claims.Username, Role: claims.Role}, nil
	}
	user, err := s.Get(claims.Username)
	if err != nil || user.SessionVersion != claims.Version {
		return User{}, errInvalidSession
	}
	return user, nil
}

// VerifyExternalSession validates a signed external (OIDC) session cookie
// without needing a user store — used when no local users are configured.
func VerifyExternalSession(r *http.Request, secret []byte) (User, error) {
	cookie, err := r.Cookie(SessionCookie)
	if err != nil {
		return User{}, errInvalidSession
	}
	encoded, signature, found := strings.Cut(cookie.Value, ".")
	if !found {
		return User{}, errInvalidSession
	}
	payload, err := base64.RawURLEncoding.DecodeString(encoded)
	if err != nil {
		return User{}, errInvalidSession
	}
	if !hmac.Equal([]byte(sign(payload, secret)), []byte(signature)) {
		return User{}, errInvalidSession
	}
	var claims sessionClaims
	if err := json.Unmarshal(payload, &claims); err != nil {
		return User{}, errInvalidSession
	}
	if !claims.External || time.Now().Unix() > claims.Expires {
		return User{}, errInvalidSession
	}
	return User{Username: claims.Username, Role: claims.Role}, nil
}
