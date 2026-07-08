package api

import (
	"encoding/json"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/bleemeo/dashglass/backend/internal/history"
	"github.com/bleemeo/dashglass/backend/internal/store"
	"github.com/bleemeo/dashglass/backend/internal/watch"
)

// bareGitDir creates a bare repository standing in for a remote.
func bareGitDir(t *testing.T) string {
	t.Helper()
	dir := filepath.Join(t.TempDir(), "remote.git")
	cmd := exec.Command("git", "init", "-q", "--bare", dir)
	cmd.Env = append(os.Environ(), "GIT_CONFIG_GLOBAL=/dev/null", "GIT_CONFIG_SYSTEM=/dev/null")
	if out, err := cmd.CombinedOutput(); err != nil {
		t.Fatalf("git init --bare: %v\n%s", err, out)
	}
	return dir
}

func getGit(t *testing.T, base string) map[string]any {
	t.Helper()
	response := doRequest(t, http.MethodGet, base+"/api/admin/git", "", "")
	if response.StatusCode != http.StatusOK {
		t.Fatalf("GET git status = %d", response.StatusCode)
	}
	var view map[string]any
	if err := json.NewDecoder(response.Body).Decode(&view); err != nil {
		t.Fatal(err)
	}
	return view
}

func TestGitRemoteConfigure(t *testing.T) {
	dir := gitDir(t)
	dashboards, err := store.New(dir)
	if err != nil {
		t.Fatal(err)
	}
	service := history.Detect(dir)
	syncer := history.NewSyncer(service, nil, time.Hour)
	stateFile := filepath.Join(t.TempDir(), "settings.yaml")
	server := newTestServer(t, Options{
		Store:     dashboards,
		Hub:       watch.NewHub(),
		History:   service,
		Syncer:    syncer,
		StateFile: stateFile,
	})

	view := getGit(t, server.URL)
	if view["editable"] != true || view["enabled"] != false || view["gitAvailable"] != true {
		t.Fatalf("initial view = %v", view)
	}

	// Configure; the token must never come back in the view.
	response := doRequest(t, http.MethodPut, server.URL+"/api/admin/git",
		"application/json",
		`{"url":"https://git.example.com/dashboards.git","username":"bot","token":"pat-1","intervalSeconds":30}`)
	if response.StatusCode != http.StatusOK {
		t.Fatalf("PUT status = %d", response.StatusCode)
	}
	view = getGit(t, server.URL)
	if view["enabled"] != true || view["url"] != "https://git.example.com/dashboards.git" {
		t.Fatalf("configured view = %v", view)
	}
	if raw, _ := json.Marshal(view); strings.Contains(string(raw), "pat-1") {
		t.Fatal("token leaked in the git view")
	}
	if view["intervalSeconds"] != float64(30) {
		t.Fatalf("interval = %v", view["intervalSeconds"])
	}
	if syncer.Remote() == nil || syncer.Remote().Password != "pat-1" {
		t.Fatal("syncer remote not swapped")
	}

	// Editing with an empty token on the SAME host keeps the secret...
	doRequest(t, http.MethodPut, server.URL+"/api/admin/git",
		"application/json",
		`{"url":"https://git.example.com/other.git","username":"bot","token":""}`)
	if syncer.Remote().Password != "pat-1" {
		t.Fatal("token must be kept on a same-host edit")
	}
	// ...but never travels to a DIFFERENT host.
	doRequest(t, http.MethodPut, server.URL+"/api/admin/git",
		"application/json",
		`{"url":"https://elsewhere.example.org/x.git","username":"bot","token":""}`)
	if syncer.Remote().Password != "" {
		t.Fatal("token must not follow a host change")
	}

	// SSH URLs are rejected with a clear message.
	response = doRequest(t, http.MethodPut, server.URL+"/api/admin/git",
		"application/json", `{"url":"git@github.com:x/y.git"}`)
	if response.StatusCode != http.StatusBadRequest {
		t.Fatalf("ssh URL status = %d, want 400", response.StatusCode)
	}

	// Clearing disables the sync.
	doRequest(t, http.MethodPut, server.URL+"/api/admin/git",
		"application/json", `{"url":""}`)
	if syncer.Remote() != nil {
		t.Fatal("clear must disable the remote")
	}
}

func TestGitRemoteSSH(t *testing.T) {
	dir := gitDir(t)
	dashboards, _ := store.New(dir)
	service := history.Detect(dir)
	syncer := history.NewSyncer(service, nil, time.Hour)
	stateFile := filepath.Join(t.TempDir(), "settings.yaml")
	server := newTestServer(t, Options{
		Store:     dashboards,
		Hub:       watch.NewHub(),
		History:   service,
		Syncer:    syncer,
		StateFile: stateFile,
	})
	putJSON := func(body map[string]any) *http.Response {
		raw, _ := json.Marshal(body)
		return doRequest(t, http.MethodPut, server.URL+"/api/admin/git",
			"application/json", string(raw))
	}
	key := "-----BEGIN OPENSSH PRIVATE KEY-----\nAAAA-not-a-real-key\n-----END OPENSSH PRIVATE KEY-----"

	// An SSH remote without a key is refused with a clear message.
	response := putJSON(map[string]any{"url": "git@github.com:acme/dash.git"})
	if response.StatusCode != http.StatusBadRequest {
		t.Fatalf("keyless ssh PUT status = %d, want 400", response.StatusCode)
	}
	// Garbage in the key field is caught before anything is written.
	response = putJSON(map[string]any{
		"url": "git@github.com:acme/dash.git", "sshKey": "ceci n'est pas une clé"})
	if response.StatusCode != http.StatusBadRequest {
		t.Fatalf("garbage key PUT status = %d, want 400", response.StatusCode)
	}

	// A pasted key lands 0600 next to the state file.
	response = putJSON(map[string]any{
		"url": "git@github.com:acme/dash.git", "sshKey": key})
	if response.StatusCode != http.StatusOK {
		t.Fatalf("ssh PUT status = %d", response.StatusCode)
	}
	keyPath := filepath.Join(filepath.Dir(stateFile), "git_ssh_key")
	info, err := os.Stat(keyPath)
	if err != nil {
		t.Fatal(err)
	}
	if info.Mode().Perm() != 0o600 {
		t.Fatalf("key file mode = %v, want 0600", info.Mode().Perm())
	}
	view := getGit(t, server.URL)
	if view["auth"] != "ssh" || view["sshKeySet"] != true {
		t.Fatalf("ssh view = %v", view)
	}
	if raw, _ := json.Marshal(view); strings.Contains(string(raw), "PRIVATE KEY") {
		t.Fatal("key leaked in the git view")
	}
	if syncer.Remote().SSHKeyFile != keyPath {
		t.Fatalf("syncer key file = %q", syncer.Remote().SSHKeyFile)
	}

	// Same-host edit with an empty key keeps the stored one.
	response = putJSON(map[string]any{"url": "git@github.com:acme/other.git"})
	if response.StatusCode != http.StatusOK {
		t.Fatalf("same-host edit status = %d", response.StatusCode)
	}
	if syncer.Remote().SSHKeyFile != keyPath {
		t.Fatal("key must be kept on a same-host edit")
	}
	// A different host requires a fresh key.
	response = putJSON(map[string]any{"url": "git@elsewhere.example.org:x.git"})
	if response.StatusCode != http.StatusBadRequest {
		t.Fatalf("cross-host edit status = %d, want 400", response.StatusCode)
	}

	// Switching to HTTPS drops the managed key file.
	response = putJSON(map[string]any{
		"url": "https://git.example.com/dash.git", "username": "bot", "token": "pat"})
	if response.StatusCode != http.StatusOK {
		t.Fatalf("https switch status = %d", response.StatusCode)
	}
	if _, err := os.Stat(keyPath); !os.IsNotExist(err) {
		t.Fatal("managed key file should be removed after switching to https")
	}
}

func TestGitRemoteProvisionedIsLocked(t *testing.T) {
	dir := gitDir(t)
	dashboards, _ := store.New(dir)
	service := history.Detect(dir)
	remote := &history.Remote{URL: "https://git.example.com/d.git"}
	server := newTestServer(t, Options{
		Store:          dashboards,
		Hub:            watch.NewHub(),
		History:        service,
		Syncer:         history.NewSyncer(service, remote, time.Hour),
		GitProvisioned: true,
		StateFile:      filepath.Join(t.TempDir(), "settings.yaml"),
	})

	view := getGit(t, server.URL)
	if view["provisioned"] != true || view["editable"] != false || view["enabled"] != true {
		t.Fatalf("view = %v", view)
	}
	response := doRequest(t, http.MethodPut, server.URL+"/api/admin/git",
		"application/json", `{"url":"https://elsewhere/x.git"}`)
	if response.StatusCode != http.StatusForbidden {
		t.Fatalf("PUT on provisioned status = %d, want 403", response.StatusCode)
	}
}

func TestGitSyncNowEndToEnd(t *testing.T) {
	dir := gitDir(t)
	dashboards, _ := store.New(dir)
	service := history.Detect(dir)
	// A local bare repository stands in for the remote (no network) —
	// injectable only through Options, the admin API refuses non-HTTP
	// URLs on purpose.
	bare := bareGitDir(t)
	syncer := history.NewSyncer(service, &history.Remote{URL: bare}, time.Hour)
	server := newTestServer(t, Options{
		Store:        dashboards,
		Hub:          watch.NewHub(),
		History:      service,
		Syncer:       syncer,
		CommitOnSave: true,
	})

	// A dashboard save commits (commit-on-save) …
	doRequest(t, http.MethodPut, server.URL+"/api/dashboards/node-overview",
		"application/yaml", validYAML)
	// … and a sync-now pushes it to the remote.
	response := doRequest(t, http.MethodPost, server.URL+"/api/admin/git/sync", "", "")
	if response.StatusCode != http.StatusOK {
		t.Fatalf("sync status = %d", response.StatusCode)
	}
	var status history.SyncStatus
	if err := json.NewDecoder(response.Body).Decode(&status); err != nil {
		t.Fatal(err)
	}
	if status.LastError != "" || !status.Enabled {
		t.Fatalf("sync result = %+v", status)
	}
	heads, err := exec.Command("git", "ls-remote", "--heads", bare).Output()
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(heads), "refs/heads/") {
		t.Fatalf("remote has no branch after sync: %q", heads)
	}
}
