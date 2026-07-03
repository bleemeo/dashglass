package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

const validDashboard = `apiVersion: v1
kind: Dashboard
metadata:
  name: ok
spec:
  panels: {}
  layouts: []
`

func TestRunLint(t *testing.T) {
	dir := t.TempDir()
	writeFile := func(name, content string) {
		t.Helper()
		if err := os.WriteFile(filepath.Join(dir, name), []byte(content), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	writeFile("ok.yaml", validDashboard)
	writeFile("broken.yaml", "kind: NotADashboard\n")
	writeFile("notes.txt", "ignored")

	var stdout, stderr strings.Builder
	code := runLint([]string{dir}, &stdout, &stderr)
	if code != 1 {
		t.Fatalf("exit code = %d, want 1\nstdout: %s\nstderr: %s", code, stdout.String(), stderr.String())
	}
	output := stdout.String()
	if !strings.Contains(output, "✓ "+filepath.Join(dir, "ok.yaml")) {
		t.Errorf("valid file not reported OK:\n%s", output)
	}
	if !strings.Contains(output, "✗ "+filepath.Join(dir, "broken.yaml")) {
		t.Errorf("invalid file not reported:\n%s", output)
	}
	if !strings.Contains(output, "2 file(s) checked, 1 invalid") {
		t.Errorf("summary missing:\n%s", output)
	}

	// All-valid run exits 0.
	stdout.Reset()
	code = runLint([]string{filepath.Join(dir, "ok.yaml")}, &stdout, &stderr)
	if code != 0 {
		t.Fatalf("exit code = %d, want 0\n%s", code, stdout.String())
	}

	// Unknown path is a usage error.
	if code := runLint([]string{filepath.Join(dir, "missing.yaml")}, &stdout, &stderr); code != 2 {
		t.Fatalf("exit code = %d, want 2", code)
	}
}
