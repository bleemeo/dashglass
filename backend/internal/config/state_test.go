package config

import (
	"path/filepath"
	"reflect"
	"testing"
)

func TestStateRoundTrip(t *testing.T) {
	path := filepath.Join(t.TempDir(), "settings.yaml")

	// A missing file is an empty state, not an error.
	state, err := LoadState(path)
	if err != nil {
		t.Fatal(err)
	}
	if state.Prometheus.URL != "" {
		t.Fatalf("missing file should load empty, got %+v", state)
	}

	state.Prometheus.URL = "http://prom:9090"
	state.Prometheus.BasicUsername = "user"
	state.Prometheus.BasicPassword = "secret"
	state.Prometheus.Headers = map[string]string{"X-Scope-OrgID": "tenant-1"}
	state.Prometheus.CACert = "-----BEGIN CERTIFICATE-----\nnot-a-real-one\n-----END CERTIFICATE-----\n"
	if err := SaveState(path, state); err != nil {
		t.Fatal(err)
	}
	loaded, err := LoadState(path)
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(loaded, state) {
		t.Fatalf("round trip mismatch: %+v != %+v", loaded, state)
	}
}

func TestStatePath(t *testing.T) {
	if got := StatePath("/data/auth.yaml"); got != "/data/settings.yaml" {
		t.Fatalf("StatePath = %q", got)
	}
}
