package ui

import (
	"net/http/httptest"
	"testing"
)

// Browsers must always revalidate the SPA entry point, otherwise a tab can
// keep rendering the UI of a previous binary after an upgrade.
func TestIndexIsNeverCached(t *testing.T) {
	handler := Handler()

	for _, path := range []string{"/", "/d/some-dashboard/edit", "/index.html"} {
		recorder := httptest.NewRecorder()
		handler.ServeHTTP(recorder, httptest.NewRequest("GET", path, nil))

		if got := recorder.Header().Get("Cache-Control"); got != "no-cache" {
			t.Errorf("GET %s: Cache-Control = %q, want %q", path, got, "no-cache")
		}
	}
}
