// Package history integrates dashboard files with git. Reads (log, show,
// diff) power the History view; the one write, Commit, records a UI save
// as a local commit when commit-on-save is enabled. Git itself is the
// version store, and the remote is never touched — pushing (or reviewing
// and committing by hand when commit-on-save is off) stays the user's or
// the GitOps pipeline's business.
package history

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"time"
)

// Commit is one entry of a file's git history.
type Commit struct {
	Hash    string `json:"hash"`
	Author  string `json:"author"`
	// Date is the author date, RFC3339.
	Date    string `json:"date"`
	Subject string `json:"subject"`
}

// Service runs git commands for files under the dashboards directory.
// A nil *Service means git is unavailable (no binary, or the directory
// is not inside a work tree). Reads are lock-free; the only write,
// Commit, is serialized (git's index allows one writer).
type Service struct {
	dir string
	mu  sync.Mutex
}

const commandTimeout = 5 * time.Second

// hashPattern matches an abbreviated or full commit hash — the only
// revision syntax accepted from the API (no refs, no ranges, no ~/^).
var hashPattern = regexp.MustCompile(`^[0-9a-f]{4,40}$`)

// ValidHash reports whether raw is an acceptable commit-hash parameter.
func ValidHash(raw string) bool {
	return hashPattern.MatchString(strings.ToLower(raw))
}

// Detect returns a Service when git is available and dir sits inside a
// git work tree, nil otherwise. Callers treat nil as "feature absent".
func Detect(dir string) *Service {
	if _, err := exec.LookPath("git"); err != nil {
		return nil
	}
	service := &Service{dir: dir}
	out, err := service.git("rev-parse", "--is-inside-work-tree")
	if err != nil || strings.TrimSpace(out) != "true" {
		return nil
	}
	return service
}

// git runs one git command in the dashboards directory and returns its
// stdout. Optional locks are disabled so read commands never take locks
// (or leave lock files) in the user's repository. The committer identity
// is pinned so Commit works in repositories with no user.name configured
// (the author carries the human identity).
func (s *Service) git(args ...string) (string, error) {
	return s.gitEnv(nil, commandTimeout, args...)
}

// gitEnv is git with extra environment variables (remote credentials)
// and a custom timeout (network operations need more than local ones).
func (s *Service) gitEnv(extraEnv []string, timeout time.Duration, args ...string) (string, error) {
	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()
	cmd := exec.CommandContext(ctx, "git", append([]string{"-C", s.dir}, args...)...)
	cmd.Env = append(os.Environ(),
		"GIT_OPTIONAL_LOCKS=0", "GIT_TERMINAL_PROMPT=0",
		"GIT_COMMITTER_NAME=Dashglass", "GIT_COMMITTER_EMAIL=dashglass@localhost")
	cmd.Env = append(cmd.Env, extraEnv...)
	var stdout, stderr strings.Builder
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr
	if err := cmd.Run(); err != nil {
		message := strings.TrimSpace(stderr.String())
		if message == "" {
			message = err.Error()
		}
		return "", fmt.Errorf("git %s: %s", args[0], message)
	}
	return stdout.String(), nil
}

// rel maps an absolute file path (as resolved by the store) to a
// cwd-relative pathspec ("./name.yaml"), the form both pathspecs and the
// <rev>:<path> syntax resolve against the -C directory.
func (s *Service) rel(path string) (string, error) {
	rel, err := filepath.Rel(s.dir, path)
	if err != nil || strings.HasPrefix(rel, "..") {
		return "", fmt.Errorf("path %q is outside the dashboards directory", path)
	}
	return "./" + filepath.ToSlash(rel), nil
}

// Log lists the commits touching a file, most recent first. Exact-path
// only: --follow is deliberately avoided, its similarity-based rename
// detection misattributes history between small, similar dashboard
// files. limit caps the number of entries (a positive value is
// required; the handler owns the default).
func (s *Service) Log(path string, limit int) ([]Commit, error) {
	rel, err := s.rel(path)
	if err != nil {
		return nil, err
	}
	// Unit separator (\x1f) fields: hash, author, author date, subject.
	out, err := s.git("log", fmt.Sprintf("-n%d", limit),
		"--format=%H%x1f%an%x1f%aI%x1f%s", "--", rel)
	if err != nil {
		// A freshly initialized repository has no commits at all; that
		// is an empty history, not an error.
		if strings.Contains(err.Error(), "does not have any commits yet") {
			return []Commit{}, nil
		}
		return nil, err
	}
	commits := []Commit{}
	for _, line := range strings.Split(strings.TrimSpace(out), "\n") {
		fields := strings.Split(line, "\x1f")
		if len(fields) != 4 {
			continue
		}
		commits = append(commits, Commit{
			Hash:    fields[0],
			Author:  fields[1],
			Date:    fields[2],
			Subject: fields[3],
		})
	}
	return commits, nil
}

// Show returns the file content at a commit.
func (s *Service) Show(path, hash string) ([]byte, error) {
	rel, err := s.rel(path)
	if err != nil {
		return nil, err
	}
	if !ValidHash(hash) {
		return nil, fmt.Errorf("invalid commit hash %q", hash)
	}
	out, err := s.git("show", strings.ToLower(hash)+":"+rel)
	if err != nil {
		return nil, err
	}
	return []byte(out), nil
}

// Commit records the current state of a file — creation, edit or
// deletion — as one git commit authored by the acting dashglass user
// (committer stays "Dashglass"). A no-op when the file matches HEAD.
// Only the given path is committed: anything else the user may have
// staged in the repository is left untouched.
func (s *Service) Commit(path, message, author, email string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	rel, err := s.rel(path)
	if err != nil {
		return err
	}
	// Stage the path: covers new files, edits and deletions alike.
	if _, err := s.git("add", "-A", "--", rel); err != nil {
		return err
	}
	// Unchanged (e.g. a save that produced identical bytes): no commit.
	status, err := s.git("status", "--porcelain", "--", rel)
	if err != nil {
		return err
	}
	if strings.TrimSpace(status) == "" {
		return nil
	}
	if author == "" {
		author = "dashglass"
	}
	if email == "" {
		email = author + "@dashglass.local"
	}
	_, err = s.git("commit", "-q",
		"-m", message,
		"--author", fmt.Sprintf("%s <%s>", author, email),
		"--", rel)
	return err
}

// Diff returns the unified diff of the file between two commits, or
// between a commit and the working tree when to is empty.
func (s *Service) Diff(path, from, to string) (string, error) {
	rel, err := s.rel(path)
	if err != nil {
		return "", err
	}
	if !ValidHash(from) {
		return "", fmt.Errorf("invalid commit hash %q", from)
	}
	args := []string{"diff", "--no-ext-diff", "--no-color", strings.ToLower(from)}
	if to != "" {
		if !ValidHash(to) {
			return "", fmt.Errorf("invalid commit hash %q", to)
		}
		args = append(args, strings.ToLower(to))
	}
	args = append(args, "--", rel)
	return s.git(args...)
}
