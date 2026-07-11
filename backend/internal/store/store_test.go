package store

import (
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

const validYAML = `
apiVersion: v1
kind: Dashboard
metadata:
  name: node-overview
spec:
  display:
    name: Node overview
  panels:
    cpu:
      kind: Panel
      spec:
        plugin:
          kind: TimeSeriesChart
        queries:
          - kind: TimeSeriesQuery
            spec:
              plugin:
                kind: PrometheusTimeSeriesQuery
                spec:
                  query: rate(node_cpu_seconds_total[5m])
  layouts:
    - kind: Grid
      spec:
        items:
          - x: 0
            y: 0
            width: 12
            height: 8
            content:
              $ref: "#/spec/panels/cpu"
  duration: 1h
`

func newTestStore(t *testing.T) *Store {
	t.Helper()
	s, err := New(t.TempDir())
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	return s
}

func TestSaveGetListDelete(t *testing.T) {
	s := newTestStore(t)

	if err := s.Save("node-overview", []byte(validYAML), FormatYAML); err != nil {
		t.Fatalf("Save: %v", err)
	}

	content, format, err := s.Get("node-overview")
	if err != nil {
		t.Fatalf("Get: %v", err)
	}
	if format != FormatYAML || string(content) != validYAML {
		t.Errorf("Get returned format %q and unexpected content", format)
	}

	infos, err := s.List()
	if err != nil {
		t.Fatalf("List: %v", err)
	}
	if len(infos) != 1 || infos[0].Name != "node-overview" ||
		infos[0].DisplayName != "Node overview" || infos[0].Invalid {
		t.Errorf("List = %+v", infos)
	}

	if err := s.Delete("node-overview"); err != nil {
		t.Fatalf("Delete: %v", err)
	}
	if _, _, err := s.Get("node-overview"); !errors.Is(err, ErrNotFound) {
		t.Errorf("Get after delete: want ErrNotFound, got %v", err)
	}
}

func TestSaveChangingFormatReplacesPreviousFile(t *testing.T) {
	s := newTestStore(t)
	if err := s.Save("node-overview", []byte(validYAML), FormatYAML); err != nil {
		t.Fatalf("Save yaml: %v", err)
	}

	asJSON := `{
	  "apiVersion": "v1",
	  "kind": "Dashboard",
	  "metadata": {"name": "node-overview"},
	  "spec": {"panels": {}, "layouts": []}
	}`
	if err := s.Save("node-overview", []byte(asJSON), FormatJSON); err != nil {
		t.Fatalf("Save json: %v", err)
	}

	if _, err := os.Stat(filepath.Join(s.Dir(), "node-overview.yaml")); !os.IsNotExist(err) {
		t.Error("yaml file should have been replaced by the json one")
	}
	_, format, err := s.Get("node-overview")
	if err != nil || format != FormatJSON {
		t.Errorf("Get: format=%q err=%v, want json", format, err)
	}
}

func TestSaveRejectsUnknownKeys(t *testing.T) {
	s := newTestStore(t)
	bad := strings.Replace(validYAML, "duration: 1h", "durationn: 1h", 1)
	err := s.Save("node-overview", []byte(bad), FormatYAML)
	var validationErr *ValidationError
	if !errors.As(err, &validationErr) {
		t.Fatalf("want ValidationError, got %v", err)
	}
	if !strings.Contains(validationErr.Error(), "durationn") {
		t.Errorf("issues should name the unknown key: %v", validationErr.Issues)
	}
}

func TestSaveRejectsDanglingLayoutRef(t *testing.T) {
	s := newTestStore(t)
	bad := strings.Replace(validYAML, "#/spec/panels/cpu", "#/spec/panels/nope", 1)
	err := s.Save("node-overview", []byte(bad), FormatYAML)
	var validationErr *ValidationError
	if !errors.As(err, &validationErr) {
		t.Fatalf("want ValidationError, got %v", err)
	}
	if !strings.Contains(validationErr.Error(), `unknown panel "nope"`) {
		t.Errorf("issues = %v", validationErr.Issues)
	}
}

func TestSaveRejectsRepeatOverUnknownVariable(t *testing.T) {
	s := newTestStore(t)
	bad := strings.Replace(validYAML,
		"      spec:\n        plugin:\n          kind: TimeSeriesChart",
		"      spec:\n        repeat:\n          variable: nope\n        plugin:\n          kind: TimeSeriesChart",
		1)
	err := s.Save("node-overview", []byte(bad), FormatYAML)
	var validationErr *ValidationError
	if !errors.As(err, &validationErr) {
		t.Fatalf("want ValidationError, got %v", err)
	}
	if !strings.Contains(validationErr.Error(), `unknown variable "nope"`) {
		t.Errorf("issues = %v", validationErr.Issues)
	}
}

func TestSaveAcceptsRepeatAndLinks(t *testing.T) {
	s := newTestStore(t)
	const doc = `
apiVersion: v1
kind: Dashboard
metadata:
  name: node-overview
spec:
  variables:
    - kind: ListVariable
      spec:
        name: instance
        plugin:
          kind: PrometheusLabelValuesVariable
          spec:
            labelName: instance
  panels:
    cpu:
      kind: Panel
      spec:
        repeat:
          variable: instance
        links:
          - title: Detail
            url: /d/host?i=$instance
        plugin:
          kind: TimeSeriesChart
  layouts:
    - kind: Grid
      spec:
        items:
          - x: 0
            y: 0
            width: 12
            height: 8
            content:
              $ref: "#/spec/panels/cpu"
`
	if err := s.Save("node-overview", []byte(doc), FormatYAML); err != nil {
		t.Fatalf("Save with repeat + links: %v", err)
	}
}

func TestSaveRejectsNameMismatch(t *testing.T) {
	s := newTestStore(t)
	err := s.Save("another-name", []byte(validYAML), FormatYAML)
	var validationErr *ValidationError
	if !errors.As(err, &validationErr) {
		t.Fatalf("want ValidationError, got %v", err)
	}
	if !strings.Contains(validationErr.Error(), "does not match") {
		t.Errorf("issues = %v", validationErr.Issues)
	}
}

func TestSaveMigratesLegacyDocuments(t *testing.T) {
	s := newTestStore(t)
	legacy := strings.Replace(validYAML, "apiVersion: v1\n", "", 1)
	if err := s.Save("node-overview", []byte(legacy), FormatYAML); err != nil {
		t.Fatalf("Save legacy document: %v", err)
	}
}

func TestCheckNameRejectsTraversal(t *testing.T) {
	for _, name := range []string{
		"", "..", `a\b`, ".hidden", "a..b",
		"a/b/c", "/a", "a/", "a//b", ".hidden/x", "x/.hidden", "a/..",
	} {
		if err := checkName(name); err == nil {
			t.Errorf("checkName(%q) should fail", name)
		}
	}
	for _, name := range []string{"node-overview.prod", "infra/node-overview"} {
		if err := checkName(name); err != nil {
			t.Errorf("checkName(%q): %v", name, err)
		}
	}
}

func TestFolderSaveGetListDelete(t *testing.T) {
	s := newTestStore(t)

	// metadata.name stays the base name; the folder is file organization.
	if err := s.Save("infra/node-overview", []byte(validYAML), FormatYAML); err != nil {
		t.Fatalf("Save in folder: %v", err)
	}
	if _, _, err := s.Get("infra/node-overview"); err != nil {
		t.Fatalf("Get in folder: %v", err)
	}
	infos, err := s.List()
	if err != nil {
		t.Fatalf("List: %v", err)
	}
	if len(infos) != 1 || infos[0].Name != "infra/node-overview" {
		t.Fatalf("List = %+v, want the folder-qualified name", infos)
	}

	if err := s.Delete("infra/node-overview"); err != nil {
		t.Fatalf("Delete: %v", err)
	}
	// The emptied folder is removed with its last dashboard.
	if _, err := os.Stat(filepath.Join(s.Dir(), "infra")); !os.IsNotExist(err) {
		t.Errorf("empty folder should have been removed, stat err = %v", err)
	}
}

func TestListFlagsInvalidFiles(t *testing.T) {
	s := newTestStore(t)
	invalid := filepath.Join(s.Dir(), "broken.yaml")
	if err := os.WriteFile(invalid, []byte("kind: Dashboard\nspec: [not a map]"), 0o644); err != nil {
		t.Fatal(err)
	}
	infos, err := s.List()
	if err != nil {
		t.Fatalf("List: %v", err)
	}
	if len(infos) != 1 || !infos[0].Invalid {
		t.Errorf("List = %+v, want broken.yaml flagged invalid", infos)
	}
}

func TestTOMLRoundTrip(t *testing.T) {
	s := newTestStore(t)
	asTOML := `
apiVersion = "v1"
kind = "Dashboard"

[metadata]
name = "minimal"

[spec]
panels = {}
layouts = []
`
	if err := s.Save("minimal", []byte(asTOML), FormatTOML); err != nil {
		t.Fatalf("Save toml: %v", err)
	}
	_, format, err := s.Get("minimal")
	if err != nil || format != FormatTOML {
		t.Errorf("Get: format=%q err=%v", format, err)
	}
}
