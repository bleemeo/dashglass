package api

import (
	"errors"
	"net/http"
	"strconv"
	"strings"

	"github.com/bleemeo/dashglass/backend/internal/store"
)

// maxCommitMessage bounds the user-supplied commit subject.
const maxCommitMessage = 200

// commitDashboard records a dashboard write as a git commit when
// commit-on-save is enabled. The file operation already succeeded: a
// commit failure is logged (and shows up as a gap in the History view)
// rather than failing the request. The optional X-Commit-Message header
// overrides the generated subject.
func (s *Server) commitDashboard(request *http.Request, path, defaultMessage string) {
	if !s.commitOnSave {
		return
	}
	message := strings.TrimSpace(request.Header.Get("X-Commit-Message"))
	if message == "" {
		message = defaultMessage
	} else if len(message) > maxCommitMessage {
		message = message[:maxCommitMessage]
	}
	user := s.usernameOf(request)
	if err := s.history.Commit(path, message, user, user+"@dashglass.local"); err != nil {
		s.logger.Warn("commit-on-save failed", "path", path, "error", err)
		return
	}
	if s.syncer != nil {
		// Push the fresh commit without waiting for the pull timer.
		s.syncer.NotifyCommit()
	}
}

// dashboardHistory serves the read-only git history of a dashboard file:
// the commit list by default, the file content at ?at=<hash>, or a
// unified diff for ?from=<hash>[&to=<hash>] (against the working tree
// when to is omitted). Restore is a regular dashboard PUT of an old
// version's content — this endpoint never writes.
func (s *Server) dashboardHistory(writer http.ResponseWriter, request *http.Request) {
	if s.history == nil {
		writeError(writer, http.StatusNotFound,
			"history requires git and a dashboards directory inside a git repository")
		return
	}
	path, format, err := s.store.FilePath(request.PathValue("name"))
	if errors.Is(err, store.ErrNotFound) {
		writeError(writer, http.StatusNotFound, err.Error())
		return
	}
	if err != nil {
		writeError(writer, http.StatusBadRequest, err.Error())
		return
	}
	query := request.URL.Query()

	if at := query.Get("at"); at != "" {
		content, err := s.history.Show(path, at)
		if err != nil {
			writeError(writer, http.StatusBadRequest, err.Error())
			return
		}
		writer.Header().Set("Content-Type", format.ContentType())
		writer.Header().Set("X-Dashboard-Format", string(format))
		writer.Write(content)
		return
	}

	if from := query.Get("from"); from != "" {
		diff, err := s.history.Diff(path, from, query.Get("to"))
		if err != nil {
			writeError(writer, http.StatusBadRequest, err.Error())
			return
		}
		writeJSON(writer, http.StatusOK, map[string]string{"diff": diff})
		return
	}

	limit := 50
	if raw := query.Get("limit"); raw != "" {
		parsed, err := strconv.Atoi(raw)
		if err != nil || parsed < 1 || parsed > 500 {
			writeError(writer, http.StatusBadRequest, "limit must be between 1 and 500")
			return
		}
		limit = parsed
	}
	commits, err := s.history.Log(path, limit)
	if err != nil {
		writeError(writer, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(writer, http.StatusOK, commits)
}
