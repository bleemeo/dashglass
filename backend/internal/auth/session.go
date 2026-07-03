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
	SessionCookie = "polaris_session"
	sessionTTL    = 7 * 24 * time.Hour
)

type sessionClaims struct {
	Username string `json:"u"`
	Version  int    `json:"v"`
	Expires  int64  `json:"e"`
}

// The cookie carries username + session version only; the role is always
// resolved from the store so role changes apply immediately.

func sign(payload []byte, secret []byte) string {
	mac := hmac.New(sha256.New, secret)
	mac.Write(payload)
	return base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
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
	user, err := s.Get(claims.Username)
	if err != nil || user.SessionVersion != claims.Version {
		return User{}, errInvalidSession
	}
	return user, nil
}
