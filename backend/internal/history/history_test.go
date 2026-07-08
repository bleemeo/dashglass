package history

import (
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

// initRepo creates a git repository with two commits of dash.yaml and
// returns the directory and the two commit hashes (oldest first).
func initRepo(t *testing.T) (dir string, hashes []string) {
	t.Helper()
	if _, err := exec.LookPath("git"); err != nil {
		t.Skip("git not available")
	}
	dir = t.TempDir()
	run := func(args ...string) string {
		t.Helper()
		cmd := exec.Command("git", append([]string{"-C", dir}, args...)...)
		// Identity via env: no reliance on (or writes to) user gitconfig.
		cmd.Env = append(os.Environ(),
			"GIT_AUTHOR_NAME=Test", "GIT_AUTHOR_EMAIL=test@example.com",
			"GIT_COMMITTER_NAME=Test", "GIT_COMMITTER_EMAIL=test@example.com",
			"GIT_CONFIG_GLOBAL=/dev/null", "GIT_CONFIG_SYSTEM=/dev/null",
		)
		out, err := cmd.CombinedOutput()
		if err != nil {
			t.Fatalf("git %v: %v\n%s", args, err, out)
		}
		return strings.TrimSpace(string(out))
	}
	run("init", "-q")
	write := func(content string) {
		t.Helper()
		if err := os.WriteFile(filepath.Join(dir, "dash.yaml"), []byte(content), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	write("kind: Dashboard\nname: old\n")
	run("add", "dash.yaml")
	run("commit", "-q", "-m", "add dashboard")
	hashes = append(hashes, run("rev-parse", "HEAD"))
	write("kind: Dashboard\nname: new\n")
	run("add", "dash.yaml")
	run("commit", "-q", "-m", "rename dashboard")
	hashes = append(hashes, run("rev-parse", "HEAD"))
	return dir, hashes
}

func TestDetect(t *testing.T) {
	dir, _ := initRepo(t)
	if Detect(dir) == nil {
		t.Fatal("Detect returned nil for a git work tree")
	}
	if Detect(t.TempDir()) != nil {
		t.Fatal("Detect returned a service for a plain directory")
	}
}

func TestLog(t *testing.T) {
	dir, hashes := initRepo(t)
	service := Detect(dir)
	commits, err := service.Log(filepath.Join(dir, "dash.yaml"), 50)
	if err != nil {
		t.Fatal(err)
	}
	if len(commits) != 2 {
		t.Fatalf("expected 2 commits, got %d", len(commits))
	}
	// Most recent first.
	if commits[0].Hash != hashes[1] || commits[1].Hash != hashes[0] {
		t.Fatalf("unexpected order: %+v", commits)
	}
	if commits[0].Subject != "rename dashboard" || commits[0].Author != "Test" {
		t.Fatalf("unexpected metadata: %+v", commits[0])
	}
	if commits[0].Date == "" {
		t.Fatal("missing date")
	}

	limited, err := service.Log(filepath.Join(dir, "dash.yaml"), 1)
	if err != nil {
		t.Fatal(err)
	}
	if len(limited) != 1 {
		t.Fatalf("limit ignored: got %d commits", len(limited))
	}
}

func TestShow(t *testing.T) {
	dir, hashes := initRepo(t)
	service := Detect(dir)
	content, err := service.Show(filepath.Join(dir, "dash.yaml"), hashes[0])
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(content), "name: old") {
		t.Fatalf("unexpected content: %s", content)
	}
	if _, err := service.Show(filepath.Join(dir, "dash.yaml"), "HEAD"); err == nil {
		t.Fatal("refs must be rejected, only hashes are allowed")
	}
	if _, err := service.Show(filepath.Join(dir, "..", "dash.yaml"), hashes[0]); err == nil {
		t.Fatal("paths outside the directory must be rejected")
	}
}

func TestCommit(t *testing.T) {
	dir, _ := initRepo(t)
	service := Detect(dir)
	path := filepath.Join(dir, "new.yaml")

	// Creation of an untracked file.
	if err := os.WriteFile(path, []byte("kind: Dashboard\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := service.Commit(path, "Create dashboard new", "alice", "alice@dashglass.local"); err != nil {
		t.Fatal(err)
	}
	commits, err := service.Log(path, 10)
	if err != nil {
		t.Fatal(err)
	}
	if len(commits) != 1 || commits[0].Subject != "Create dashboard new" || commits[0].Author != "alice" {
		t.Fatalf("unexpected log after create: %+v", commits)
	}

	// Unchanged file → no new commit.
	if err := service.Commit(path, "noop", "alice", ""); err != nil {
		t.Fatal(err)
	}
	if commits, _ = service.Log(path, 10); len(commits) != 1 {
		t.Fatalf("no-op save must not commit, log: %+v", commits)
	}

	// Edit, then deletion.
	if err := os.WriteFile(path, []byte("kind: Dashboard\nname: x\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := service.Commit(path, "Update dashboard new", "bob", ""); err != nil {
		t.Fatal(err)
	}
	if err := os.Remove(path); err != nil {
		t.Fatal(err)
	}
	if err := service.Commit(path, "Delete dashboard new", "bob", ""); err != nil {
		t.Fatal(err)
	}
	commits, err = service.Log(path, 10)
	if err != nil {
		t.Fatal(err)
	}
	if len(commits) != 3 || commits[0].Subject != "Delete dashboard new" {
		t.Fatalf("unexpected log after delete: %+v", commits)
	}

	// Other staged work must survive a dashboard commit untouched.
	other := filepath.Join(dir, "unrelated.txt")
	if err := os.WriteFile(other, []byte("keep me staged\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	if _, err := service.git("add", "--", "./unrelated.txt"); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte("kind: Dashboard\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := service.Commit(path, "Recreate dashboard new", "alice", ""); err != nil {
		t.Fatal(err)
	}
	status, err := service.git("status", "--porcelain", "--", "./unrelated.txt")
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(status, "A ") {
		t.Fatalf("unrelated staged file was disturbed: %q", status)
	}
}

func TestDiff(t *testing.T) {
	dir, hashes := initRepo(t)
	service := Detect(dir)
	diff, err := service.Diff(filepath.Join(dir, "dash.yaml"), hashes[0], hashes[1])
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(diff, "-name: old") || !strings.Contains(diff, "+name: new") {
		t.Fatalf("unexpected diff:\n%s", diff)
	}
	// One-line edit → one removed and one added line (deterministic
	// serialization is the point of the whole file format). The ---/+++
	// file headers don't count.
	removed, added := 0, 0
	for _, line := range strings.Split(diff, "\n") {
		switch {
		case strings.HasPrefix(line, "---") || strings.HasPrefix(line, "+++"):
		case strings.HasPrefix(line, "-"):
			removed++
		case strings.HasPrefix(line, "+"):
			added++
		}
	}
	if removed != 1 || added != 1 {
		t.Fatalf("expected a one-line diff (got -%d/+%d):\n%s", removed, added, diff)
	}

	// from vs the working tree (uncommitted edit).
	if err := os.WriteFile(filepath.Join(dir, "dash.yaml"), []byte("kind: Dashboard\nname: wip\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	workingDiff, err := service.Diff(filepath.Join(dir, "dash.yaml"), hashes[1], "")
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(workingDiff, "+name: wip") {
		t.Fatalf("expected working-tree diff:\n%s", workingDiff)
	}

	if _, err := service.Diff(filepath.Join(dir, "dash.yaml"), "main", ""); err == nil {
		t.Fatal("refs must be rejected, only hashes are allowed")
	}
}
