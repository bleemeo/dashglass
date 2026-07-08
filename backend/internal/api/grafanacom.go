package api

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"regexp"
	"time"
)

// The grafana.com download proxy exists because browsers cannot fetch
// grafana.com directly (CORS). It is deliberately narrow to rule out SSRF:
// the client sends a numeric dashboard id only — never a URL — and the
// upstream host is pinned by configuration, redirects included.

// maxGrafanaComSize bounds downloaded dashboards; the marketplace's biggest
// are well under 1 MiB.
const maxGrafanaComSize = 5 << 20

var grafanaComIDPattern = regexp.MustCompile(`^[0-9]{1,10}$`)

type grafanaComClient struct {
	base   string // e.g. "https://grafana.com", host-pinned
	client *http.Client
}

func newGrafanaComClient(base string) *grafanaComClient {
	return &grafanaComClient{
		base: base,
		client: &http.Client{
			Timeout: 15 * time.Second,
			CheckRedirect: func(req *http.Request, via []*http.Request) error {
				if req.URL.Host != via[0].URL.Host {
					return fmt.Errorf("redirect to foreign host %q refused", req.URL.Host)
				}
				if len(via) >= 5 {
					return fmt.Errorf("too many redirects")
				}
				return nil
			},
		},
	}
}

func (c *grafanaComClient) getJSON(url string, into any) error {
	request, err := http.NewRequest(http.MethodGet, url, nil)
	if err != nil {
		return err
	}
	request.Header.Set("User-Agent", "dashglass-dashboard-import")
	response, err := c.client.Do(request)
	if err != nil {
		return err
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return fmt.Errorf("grafana.com answered %s", response.Status)
	}
	body := io.LimitReader(response.Body, maxGrafanaComSize)
	return json.NewDecoder(body).Decode(into)
}

// grafanaCom handles GET /api/grafana-com/{id}: resolves the latest
// revision of a marketplace dashboard and returns it wrapped with the
// marketplace metadata (name and description are often richer there than
// inside the dashboard JSON itself).
func (s *Server) grafanaComDownload(writer http.ResponseWriter, request *http.Request) {
	if s.grafanaCom == nil {
		writeError(writer, http.StatusServiceUnavailable,
			"grafana.com import is disabled on this instance")
		return
	}
	id := request.PathValue("id")
	if !grafanaComIDPattern.MatchString(id) {
		writeError(writer, http.StatusBadRequest, "expected a numeric grafana.com dashboard id")
		return
	}

	var meta struct {
		Name        string `json:"name"`
		Description string `json:"description"`
		Revision    int    `json:"revision"`
	}
	metaURL := fmt.Sprintf("%s/api/dashboards/%s", s.grafanaCom.base, id)
	if err := s.grafanaCom.getJSON(metaURL, &meta); err != nil {
		writeError(writer, http.StatusBadGateway,
			fmt.Sprintf("fetching dashboard %s metadata: %s", id, err))
		return
	}
	if meta.Revision <= 0 {
		meta.Revision = 1
	}

	var dashboard json.RawMessage
	downloadURL := fmt.Sprintf("%s/api/dashboards/%s/revisions/%d/download",
		s.grafanaCom.base, id, meta.Revision)
	if err := s.grafanaCom.getJSON(downloadURL, &dashboard); err != nil {
		writeError(writer, http.StatusBadGateway,
			fmt.Sprintf("downloading dashboard %s revision %d: %s", id, meta.Revision, err))
		return
	}

	writeJSON(writer, http.StatusOK, map[string]any{
		"dashboard":   dashboard,
		"name":        meta.Name,
		"description": meta.Description,
		"revision":    meta.Revision,
	})
}
