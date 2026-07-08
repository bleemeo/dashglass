package api

import (
	"encoding/json"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"time"

	"github.com/bleemeo/dashglass/backend/internal/config"
	"github.com/bleemeo/dashglass/backend/internal/history"
)

// gitRemoteBody is the admin's git-sync edit/test payload. Token and
// sshKey are write-only; empty keeps the stored one as long as the
// remote HOST is unchanged (credentials must never silently travel to a
// new host).
type gitRemoteBody struct {
	URL             string `json:"url"`
	Username        string `json:"username"`
	Token           string `json:"token"`
	SSHKey          string `json:"sshKey"`
	IntervalSeconds int    `json:"intervalSeconds"`
}

// scpLikePattern matches git's scp-like syntax (git@github.com:acme/x).
var scpLikePattern = regexp.MustCompile(`^(?:[A-Za-z0-9._-]+@)?([A-Za-z0-9._-]+):[^/].*$`)

// isSSHRemote reports whether a remote URL uses SSH (ssh:// or scp-like).
func isSSHRemote(raw string) bool {
	return strings.HasPrefix(raw, "ssh://") || scpLikePattern.MatchString(raw)
}

// remoteHost extracts the host of an https/ssh/scp-like remote URL, for
// the keep-credentials-on-same-host rule ("" when unrecognized).
func remoteHost(raw string) string {
	if match := scpLikePattern.FindStringSubmatch(raw); match != nil {
		return match[1]
	}
	if parsed, err := url.Parse(raw); err == nil {
		return parsed.Host
	}
	return ""
}

// gitView is the GET shape; the token is never returned.
func (s *Server) gitView() map[string]any {
	view := map[string]any{
		"gitAvailable": s.history != nil,
		"commitOnSave": s.commitOnSave,
		"provisioned":  s.gitProvisioned,
		"editable":     !s.gitProvisioned && s.stateFile != "" && s.syncer != nil,
		"enabled":      false,
	}
	if s.syncer == nil {
		return view
	}
	if remote := s.syncer.Remote(); remote != nil {
		view["enabled"] = true
		view["url"] = remote.URL
		view["username"] = remote.Username
		if remote.SSHKeyFile != "" {
			view["auth"] = "ssh"
			view["sshKeySet"] = true
		} else {
			view["auth"] = "https"
		}
	}
	view["intervalSeconds"] = int(s.syncer.Interval() / time.Second)
	view["status"] = s.syncer.Status()
	return view
}

// gitKnownHosts is the pinned-host-keys file handed to ssh.
func (s *Server) gitKnownHosts() string {
	if s.stateFile == "" {
		return filepath.Join(os.TempDir(), "dashglass_git_known_hosts")
	}
	return config.KnownHostsPath(s.stateFile)
}

// resolveSSHKey returns the private-key file for an SSH-remote body: the
// pasted key written to the managed path (persist=true) or a temporary
// file whose cleanup is returned (persist=false, for tests), or the
// stored key when the field is empty and the host is unchanged. An empty
// keyFile with a nil error means "no key available".
func (s *Server) resolveSSHKey(
	body gitRemoteBody, previous *history.Remote, persist bool,
) (keyFile string, cleanup func(), err error) {
	cleanup = func() {}
	if body.SSHKey == "" {
		if previous != nil && previous.SSHKeyFile != "" &&
			remoteHost(previous.URL) == remoteHost(body.URL) {
			return previous.SSHKeyFile, cleanup, nil
		}
		return "", cleanup, nil
	}
	if !strings.Contains(body.SSHKey, "PRIVATE KEY-----") {
		return "", cleanup, errInvalid(
			"this does not look like a private key (paste the full PEM/OpenSSH block)")
	}
	// ssh requires a newline-terminated key file.
	content := body.SSHKey
	if !strings.HasSuffix(content, "\n") {
		content += "\n"
	}
	if persist {
		if s.stateFile == "" {
			return "", cleanup, errInvalid("runtime settings are disabled on this instance")
		}
		keyFile = config.SSHKeyPath(s.stateFile)
		if err := os.WriteFile(keyFile, []byte(content), 0o600); err != nil {
			return "", cleanup, err
		}
		return keyFile, cleanup, nil
	}
	temp, err := os.CreateTemp(filepath.Dir(s.gitKnownHosts()), "git_ssh_key_test_*")
	if err != nil {
		return "", cleanup, err
	}
	if err := temp.Chmod(0o600); err == nil {
		_, err = temp.WriteString(content)
	}
	temp.Close()
	if err != nil {
		os.Remove(temp.Name())
		return "", cleanup, err
	}
	return temp.Name(), func() { os.Remove(temp.Name()) }, nil
}

// buildRemote validates a body into a Remote. SSH remotes carry the
// resolved key file; HTTPS remotes inherit the stored token when left
// empty and the host is unchanged.
func (s *Server) buildRemote(
	body gitRemoteBody, previous *history.Remote, sshKeyFile string,
) (*history.Remote, error) {
	if isSSHRemote(body.URL) {
		if sshKeyFile == "" {
			return nil, errInvalid("an SSH remote needs a private key (paste an unencrypted deploy key)")
		}
		return &history.Remote{
			URL:               body.URL,
			SSHKeyFile:        sshKeyFile,
			SSHKnownHostsFile: s.gitKnownHosts(),
		}, nil
	}
	parsed, err := url.Parse(body.URL)
	if err != nil || (parsed.Scheme != "http" && parsed.Scheme != "https") || parsed.Host == "" {
		return nil, errInvalid(
			"the remote URL must be http(s)://, ssh:// or scp-like (git@host:path)")
	}
	if parsed.User != nil {
		return nil, errInvalid("credentials go in the username/token fields, not the URL")
	}
	token := body.Token
	if token == "" && previous != nil {
		if prevURL, err := url.Parse(previous.URL); err == nil && prevURL.Host == parsed.Host {
			token = previous.Password
		}
	}
	return &history.Remote{
		URL:      body.URL,
		Username: body.Username,
		Password: token,
	}, nil
}

func (s *Server) adminGetGit(writer http.ResponseWriter, _ *http.Request) {
	writeJSON(writer, http.StatusOK, s.gitView())
}

// adminPutGit reconfigures the sync remote at runtime: persists to the
// state file, swaps the syncer's remote (which triggers a cycle).
// Refused when dashglass.yaml provisions the remote.
func (s *Server) adminPutGit(writer http.ResponseWriter, request *http.Request) {
	if s.gitProvisioned {
		writeError(writer, http.StatusForbidden,
			"the git remote is provisioned in dashglass.yaml; edit the deployment instead")
		return
	}
	if s.syncer == nil || s.stateFile == "" {
		writeError(writer, http.StatusForbidden,
			"git sync needs the dashboards directory inside a git work tree")
		return
	}
	var body gitRemoteBody
	if err := json.NewDecoder(request.Body).Decode(&body); err != nil {
		writeError(writer, http.StatusBadRequest, "invalid JSON body")
		return
	}

	s.stateMu.Lock()
	defer s.stateMu.Unlock()
	state, err := config.LoadState(s.stateFile)
	if err != nil {
		writeError(writer, http.StatusInternalServerError, err.Error())
		return
	}

	// An empty URL disables the sync (and drops the managed key file).
	if body.URL == "" {
		state.Git = config.GitState{}
		if err := config.SaveState(s.stateFile, state); err != nil {
			writeError(writer, http.StatusInternalServerError, err.Error())
			return
		}
		os.Remove(config.SSHKeyPath(s.stateFile))
		s.syncer.SetRemote(nil, 0)
		s.logger.Info("git sync disabled", "by", s.usernameOf(request))
		writeJSON(writer, http.StatusOK, s.gitView())
		return
	}

	keyFile := ""
	if isSSHRemote(body.URL) {
		var err error
		if keyFile, _, err = s.resolveSSHKey(body, s.syncer.Remote(), true); err != nil {
			writeError(writer, http.StatusBadRequest, err.Error())
			return
		}
	}
	remote, err := s.buildRemote(body, s.syncer.Remote(), keyFile)
	if err != nil {
		writeError(writer, http.StatusBadRequest, err.Error())
		return
	}
	interval := time.Duration(body.IntervalSeconds) * time.Second
	state.Git = config.GitState{
		RemoteURL:       remote.URL,
		Username:        remote.Username,
		Token:           remote.Password,
		SSHKeyFile:      remote.SSHKeyFile,
		IntervalSeconds: body.IntervalSeconds,
	}
	if err := config.SaveState(s.stateFile, state); err != nil {
		writeError(writer, http.StatusInternalServerError, err.Error())
		return
	}
	if remote.SSHKeyFile == "" {
		// Switching to HTTPS: the managed key has no user anymore.
		os.Remove(config.SSHKeyPath(s.stateFile))
	}
	s.syncer.SetRemote(remote, interval)
	s.logger.Info("git sync configured", "url", remote.URL, "by", s.usernameOf(request))
	writeJSON(writer, http.StatusOK, s.gitView())
}

// adminTestGit probes a candidate remote (ls-remote) without saving.
func (s *Server) adminTestGit(writer http.ResponseWriter, request *http.Request) {
	if s.history == nil {
		writeError(writer, http.StatusForbidden,
			"git sync needs the dashboards directory inside a git work tree")
		return
	}
	var body gitRemoteBody
	if err := json.NewDecoder(request.Body).Decode(&body); err != nil {
		writeError(writer, http.StatusBadRequest, "invalid JSON body")
		return
	}
	var previous *history.Remote
	if s.syncer != nil {
		previous = s.syncer.Remote()
	}
	keyFile := ""
	if isSSHRemote(body.URL) {
		// A pasted key is written to a throwaway file for the probe.
		resolved, cleanup, err := s.resolveSSHKey(body, previous, false)
		if err != nil {
			writeError(writer, http.StatusBadRequest, err.Error())
			return
		}
		defer cleanup()
		keyFile = resolved
	}
	remote, err := s.buildRemote(body, previous, keyFile)
	if err != nil {
		writeError(writer, http.StatusBadRequest, err.Error())
		return
	}
	if err := s.history.TestRemote(remote); err != nil {
		writeJSON(writer, http.StatusOK,
			map[string]any{"reachable": false, "error": err.Error()})
		return
	}
	writeJSON(writer, http.StatusOK, map[string]any{"reachable": true})
}

// adminSyncGit runs one sync cycle right now and returns the result.
func (s *Server) adminSyncGit(writer http.ResponseWriter, _ *http.Request) {
	if s.syncer == nil {
		writeError(writer, http.StatusForbidden,
			"git sync needs the dashboards directory inside a git work tree")
		return
	}
	writeJSON(writer, http.StatusOK, s.syncer.SyncNow())
}
