package history

import (
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// bareRemote creates a bare repository to act as the remote.
func bareRemote(t *testing.T) string {
	t.Helper()
	dir := filepath.Join(t.TempDir(), "remote.git")
	cmd := exec.Command("git", "init", "-q", "--bare", dir)
	cmd.Env = append(os.Environ(), "GIT_CONFIG_GLOBAL=/dev/null", "GIT_CONFIG_SYSTEM=/dev/null")
	if out, err := cmd.CombinedOutput(); err != nil {
		t.Fatalf("git init --bare: %v\n%s", err, out)
	}
	return dir
}

func newSyncer(t *testing.T, dir, remoteURL string) *Syncer {
	t.Helper()
	service := Detect(dir)
	if service == nil {
		t.Fatal("no git service")
	}
	return NewSyncer(service, &Remote{URL: remoteURL}, time.Hour)
}

func TestSyncPushesLocalCommits(t *testing.T) {
	dir, _ := initRepo(t)
	remote := bareRemote(t)
	syncer := newSyncer(t, dir, remote)

	status := syncer.SyncNow()
	if status.LastError != "" {
		t.Fatalf("sync error: %s", status.LastError)
	}
	if status.Ahead != 0 || status.Behind != 0 {
		t.Fatalf("status after publish = %+v", status)
	}
	// The bare remote now has the branch with both commits.
	out, err := syncer.service.gitEnv(nil, networkTimeout,
		"ls-remote", "--heads", "--", remote)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(out, "refs/heads/") {
		t.Fatalf("remote has no branch after sync: %q", out)
	}

	// A new local commit is pushed by the next cycle.
	if err := os.WriteFile(filepath.Join(dir, "dash.yaml"),
		[]byte("kind: Dashboard\nname: pushed\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := syncer.service.Commit(filepath.Join(dir, "dash.yaml"), "edit", "alice", ""); err != nil {
		t.Fatal(err)
	}
	if status = syncer.SyncNow(); status.LastError != "" {
		t.Fatalf("push cycle error: %s", status.LastError)
	}
	local, _ := syncer.service.git("rev-parse", "HEAD")
	remoteRef, _ := syncer.service.gitEnv(nil, networkTimeout,
		"ls-remote", "--", remote, "HEAD")
	if !strings.HasPrefix(remoteRef, strings.TrimSpace(local)) {
		t.Fatalf("remote HEAD %q != local %q", remoteRef, local)
	}
}

func TestSyncPullsRemoteCommits(t *testing.T) {
	dirA, _ := initRepo(t)
	remote := bareRemote(t)
	syncerA := newSyncer(t, dirA, remote)
	if status := syncerA.SyncNow(); status.LastError != "" {
		t.Fatalf("publish error: %s", status.LastError)
	}

	// A second work tree pushes a change...
	dirB, _ := initRepo(t)
	syncerB := newSyncer(t, dirB, remote)
	// B's history is unrelated to A's: reset B onto the remote first.
	if _, err := syncerB.service.gitEnv(nil, networkTimeout, "fetch", "--", remote); err != nil {
		t.Fatal(err)
	}
	if _, err := syncerB.service.git("reset", "--hard", "FETCH_HEAD"); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dirB, "dash.yaml"),
		[]byte("kind: Dashboard\nname: from-b\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := syncerB.service.Commit(filepath.Join(dirB, "dash.yaml"), "from B", "bob", ""); err != nil {
		t.Fatal(err)
	}
	if status := syncerB.SyncNow(); status.LastError != "" {
		t.Fatalf("B push error: %s", status.LastError)
	}

	// ...and A's next cycle fast-forwards onto it.
	if status := syncerA.SyncNow(); status.LastError != "" {
		t.Fatalf("A pull error: %s", status.LastError)
	}
	content, err := os.ReadFile(filepath.Join(dirA, "dash.yaml"))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(content), "from-b") {
		t.Fatalf("A did not pull B's change: %s", content)
	}
}

func TestSyncRebasesDivergedHistories(t *testing.T) {
	dirA, _ := initRepo(t)
	remote := bareRemote(t)
	syncerA := newSyncer(t, dirA, remote)
	syncerA.SyncNow()

	dirB, _ := initRepo(t)
	syncerB := newSyncer(t, dirB, remote)
	if _, err := syncerB.service.gitEnv(nil, networkTimeout, "fetch", "--", remote); err != nil {
		t.Fatal(err)
	}
	if _, err := syncerB.service.git("reset", "--hard", "FETCH_HEAD"); err != nil {
		t.Fatal(err)
	}

	// B pushes a NEW file while A commits a different NEW file locally:
	// diverged but conflict-free → rebase + push must reconcile.
	if err := os.WriteFile(filepath.Join(dirB, "b.yaml"), []byte("kind: B\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := syncerB.service.Commit(filepath.Join(dirB, "b.yaml"), "add b", "bob", ""); err != nil {
		t.Fatal(err)
	}
	if status := syncerB.SyncNow(); status.LastError != "" {
		t.Fatalf("B push error: %s", status.LastError)
	}
	if err := os.WriteFile(filepath.Join(dirA, "a.yaml"), []byte("kind: A\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := syncerA.service.Commit(filepath.Join(dirA, "a.yaml"), "add a", "alice", ""); err != nil {
		t.Fatal(err)
	}

	if status := syncerA.SyncNow(); status.LastError != "" {
		t.Fatalf("diverged sync error: %s", status.LastError)
	}
	// A has both files, and the remote has A's commit.
	if _, err := os.Stat(filepath.Join(dirA, "b.yaml")); err != nil {
		t.Fatal("A is missing B's file after rebase")
	}
	local, _ := syncerA.service.git("rev-parse", "HEAD")
	remoteRef, _ := syncerA.service.gitEnv(nil, networkTimeout,
		"ls-remote", "--", remote, "HEAD")
	if !strings.HasPrefix(remoteRef, strings.TrimSpace(local)) {
		t.Fatalf("remote HEAD %q != local %q after rebase+push", remoteRef, local)
	}
}

func TestRemoteEnv(t *testing.T) {
	// SSH remote: a pinned GIT_SSH_COMMAND, no askpass.
	env := remoteEnv(&Remote{
		URL:               "git@github.com:acme/dash.git",
		SSHKeyFile:        "/data/git_ssh_key",
		SSHKnownHostsFile: "/data/git_known_hosts",
	})
	if len(env) != 1 || !strings.HasPrefix(env[0], "GIT_SSH_COMMAND=") {
		t.Fatalf("ssh env = %v", env)
	}
	for _, needle := range []string{
		"-i '/data/git_ssh_key'",
		"UserKnownHostsFile='/data/git_known_hosts'",
		"StrictHostKeyChecking=accept-new",
		"BatchMode=yes",
		"IdentitiesOnly=yes",
	} {
		if !strings.Contains(env[0], needle) {
			t.Fatalf("ssh command misses %q: %s", needle, env[0])
		}
	}

	// HTTPS remote: askpass variables, no ssh command.
	env = remoteEnv(&Remote{URL: "https://x/y.git", Username: "bot", Password: "tok"})
	joined := strings.Join(env, "\n")
	if !strings.Contains(joined, "GIT_ASKPASS=") ||
		!strings.Contains(joined, "DASHGLASS_ASKPASS_PASSWORD=tok") ||
		strings.Contains(joined, "GIT_SSH_COMMAND") {
		t.Fatalf("https env = %v", env)
	}

	// No credentials at all: nothing to inject.
	if env := remoteEnv(&Remote{URL: "https://x/y.git"}); len(env) != 0 {
		t.Fatalf("bare env = %v", env)
	}
}

func TestSyncDisabled(t *testing.T) {
	dir, _ := initRepo(t)
	syncer := NewSyncer(Detect(dir), nil, 0)
	status := syncer.SyncNow()
	if status.Enabled {
		t.Fatalf("nil remote must stay disabled: %+v", status)
	}
	syncer.SetRemote(&Remote{URL: bareRemote(t)}, 0)
	if status = syncer.SyncNow(); !status.Enabled || status.LastError != "" {
		t.Fatalf("after SetRemote: %+v", status)
	}
}
