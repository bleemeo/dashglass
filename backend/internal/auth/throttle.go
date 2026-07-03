package auth

import (
	"net"
	"net/http"
	"sync"
	"time"
)

const (
	throttleAfter  = 5
	throttleWindow = 30 * time.Second
)

// Throttle locks an IP out of login for a short window after repeated
// failures — a brake on brute force, not a substitute for good passwords.
type Throttle struct {
	mu       sync.Mutex
	failures map[string]*throttleEntry
}

type throttleEntry struct {
	count int
	until time.Time
}

func NewThrottle() *Throttle {
	return &Throttle{failures: map[string]*throttleEntry{}}
}

func clientIP(r *http.Request) string {
	if host, _, err := net.SplitHostPort(r.RemoteAddr); err == nil {
		return host
	}
	return r.RemoteAddr
}

// Blocked reports whether this client must wait before another attempt.
func (t *Throttle) Blocked(r *http.Request) bool {
	t.mu.Lock()
	defer t.mu.Unlock()
	entry := t.failures[clientIP(r)]
	return entry != nil && entry.count >= throttleAfter && time.Now().Before(entry.until)
}

// Failure records a failed attempt.
func (t *Throttle) Failure(r *http.Request) {
	t.mu.Lock()
	defer t.mu.Unlock()
	ip := clientIP(r)
	entry := t.failures[ip]
	if entry == nil || time.Now().After(entry.until) {
		entry = &throttleEntry{}
		t.failures[ip] = entry
	}
	entry.count++
	entry.until = time.Now().Add(throttleWindow)
}

// Success clears the counter.
func (t *Throttle) Success(r *http.Request) {
	t.mu.Lock()
	defer t.mu.Unlock()
	delete(t.failures, clientIP(r))
}
