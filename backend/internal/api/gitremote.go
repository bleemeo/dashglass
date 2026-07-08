package api

import (
	"encoding/json"
	"net/http"
	"net/url"
	"time"

	"github.com/bleemeo/polarisui/backend/internal/config"
	"github.com/bleemeo/polarisui/backend/internal/history"
)

// gitRemoteBody is the admin's git-sync edit/test payload. The token is
// write-only; empty keeps the stored one as long as the remote HOST is
// unchanged (a token must never silently travel to a new host).
type gitRemoteBody struct {
	URL             string `json:"url"`
	Username        string `json:"username"`
	Token           string `json:"token"`
	IntervalSeconds int    `json:"intervalSeconds"`
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
	}
	view["intervalSeconds"] = int(s.syncer.Interval() / time.Second)
	view["status"] = s.syncer.Status()
	return view
}

// buildRemote validates a body into a Remote, inheriting the stored
// token when left empty and the host is unchanged.
func buildRemote(body gitRemoteBody, previous *history.Remote) (*history.Remote, error) {
	parsed, err := url.Parse(body.URL)
	if err != nil || (parsed.Scheme != "http" && parsed.Scheme != "https") || parsed.Host == "" {
		return nil, errInvalid("the remote URL must be http(s):// (SSH remotes are not supported yet)")
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
// Refused when polaris.yaml provisions the remote.
func (s *Server) adminPutGit(writer http.ResponseWriter, request *http.Request) {
	if s.gitProvisioned {
		writeError(writer, http.StatusForbidden,
			"the git remote is provisioned in polaris.yaml; edit the deployment instead")
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

	// An empty URL disables the sync.
	if body.URL == "" {
		state.Git = config.GitState{}
		if err := config.SaveState(s.stateFile, state); err != nil {
			writeError(writer, http.StatusInternalServerError, err.Error())
			return
		}
		s.syncer.SetRemote(nil, 0)
		s.logger.Info("git sync disabled", "by", s.usernameOf(request))
		writeJSON(writer, http.StatusOK, s.gitView())
		return
	}

	remote, err := buildRemote(body, s.syncer.Remote())
	if err != nil {
		writeError(writer, http.StatusBadRequest, err.Error())
		return
	}
	interval := time.Duration(body.IntervalSeconds) * time.Second
	state.Git = config.GitState{
		RemoteURL:       remote.URL,
		Username:        remote.Username,
		Token:           remote.Password,
		IntervalSeconds: body.IntervalSeconds,
	}
	if err := config.SaveState(s.stateFile, state); err != nil {
		writeError(writer, http.StatusInternalServerError, err.Error())
		return
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
	remote, err := buildRemote(body, previous)
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
