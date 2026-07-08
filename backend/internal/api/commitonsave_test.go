package api

import (
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"

	"github.com/bleemeo/dashglass/backend/internal/history"
	"github.com/bleemeo/dashglass/backend/internal/store"
	"github.com/bleemeo/dashglass/backend/internal/watch"
)

// gitDir initializes an empty git repository to serve as dashboards dir.
func gitDir(t *testing.T) string {
	t.Helper()
	if _, err := exec.LookPath("git"); err != nil {
		t.Skip("git not available")
	}
	dir := t.TempDir()
	cmd := exec.Command("git", "-C", dir, "init", "-q")
	cmd.Env = append(os.Environ(), "GIT_CONFIG_GLOBAL=/dev/null", "GIT_CONFIG_SYSTEM=/dev/null")
	if out, err := cmd.CombinedOutput(); err != nil {
		t.Fatalf("git init: %v\n%s", err, out)
	}
	return dir
}

func TestCommitOnSave(t *testing.T) {
	dir := gitDir(t)
	dashboards, err := store.New(dir)
	if err != nil {
		t.Fatal(err)
	}
	service := history.Detect(dir)
	if service == nil {
		t.Fatal("history service not detected on a git work tree")
	}
	server := newTestServer(t, Options{
		Store:        dashboards,
		Hub:          watch.NewHub(),
		History:      service,
		CommitOnSave: true,
	})
	path := filepath.Join(dir, "node-overview.yaml")

	// Create → one commit, authored by the acting (anonymous) user.
	response := doRequest(t, http.MethodPut, server.URL+"/api/dashboards/node-overview",
		"application/yaml", validYAML)
	if response.StatusCode != http.StatusOK {
		t.Fatalf("PUT status = %d", response.StatusCode)
	}
	commits, err := service.Log(path, 10)
	if err != nil {
		t.Fatal(err)
	}
	if len(commits) != 1 || commits[0].Subject != "Create dashboard node-overview" {
		t.Fatalf("log after create: %+v", commits)
	}
	if commits[0].Author != "anonymous" {
		t.Fatalf("commit author = %q, want the acting user", commits[0].Author)
	}

	// Identical save → no second commit.
	doRequest(t, http.MethodPut, server.URL+"/api/dashboards/node-overview",
		"application/yaml", validYAML)
	if commits, _ = service.Log(path, 10); len(commits) != 1 {
		t.Fatalf("identical save must not commit, log: %+v", commits)
	}

	// Edit with a custom message via the X-Commit-Message header.
	edited := strings.Replace(validYAML, "panels: {}", "panels: {}\n  duration: 6h", 1)
	request, _ := http.NewRequest(http.MethodPut,
		server.URL+"/api/dashboards/node-overview", strings.NewReader(edited))
	request.Header.Set("Content-Type", "application/yaml")
	request.Header.Set("X-Commit-Message", "Bump the default range to 6h")
	editResponse, err := http.DefaultClient.Do(request)
	if err != nil {
		t.Fatal(err)
	}
	editResponse.Body.Close()
	if editResponse.StatusCode != http.StatusOK {
		t.Fatalf("edit PUT status = %d", editResponse.StatusCode)
	}
	commits, _ = service.Log(path, 10)
	if len(commits) != 2 || commits[0].Subject != "Bump the default range to 6h" {
		t.Fatalf("log after edit: %+v", commits)
	}

	// Delete → a third commit; the file is gone from the work tree.
	response = doRequest(t, http.MethodDelete, server.URL+"/api/dashboards/node-overview", "", "")
	if response.StatusCode != http.StatusNoContent {
		t.Fatalf("DELETE status = %d", response.StatusCode)
	}
	commits, _ = service.Log(path, 10)
	if len(commits) != 3 || commits[0].Subject != "Delete dashboard node-overview" {
		t.Fatalf("log after delete: %+v", commits)
	}
	if _, err := os.Stat(path); !os.IsNotExist(err) {
		t.Fatal("file should be deleted")
	}
}

func TestNoCommitWhenDisabled(t *testing.T) {
	dir := gitDir(t)
	dashboards, err := store.New(dir)
	if err != nil {
		t.Fatal(err)
	}
	service := history.Detect(dir)
	server := newTestServer(t, Options{
		Store:   dashboards,
		Hub:     watch.NewHub(),
		History: service, // history on, commit-on-save off (the default)
	})

	doRequest(t, http.MethodPut, server.URL+"/api/dashboards/node-overview",
		"application/yaml", validYAML)
	commits, err := service.Log(filepath.Join(dir, "node-overview.yaml"), 10)
	if err != nil {
		t.Fatal(err)
	}
	if len(commits) != 0 {
		t.Fatalf("commit-on-save is off, log should be empty: %+v", commits)
	}
}
