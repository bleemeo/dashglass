// Package store manages the dashboards directory: the file-based storage
// that makes dashboards GitOps-friendly. Files are validated against the
// dashboard schema on read and write; writes are atomic.
package store

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"

	"github.com/santhosh-tekuri/jsonschema/v6"
)

// ErrNotFound is returned when no file matches a dashboard name.
var ErrNotFound = errors.New("dashboard not found")

// Info describes a dashboard file, as returned by List.
type Info struct {
	Name        string `json:"name"`
	Format      Format `json:"format"`
	DisplayName string `json:"displayName,omitempty"`
	Description string `json:"description,omitempty"`
	// Invalid flags files that fail validation; they are still listed so
	// the UI can surface the problem instead of silently hiding the file.
	Invalid bool `json:"invalid,omitempty"`
}

// Store reads and writes dashboard files in a single directory.
type Store struct {
	dir    string
	schema *jsonschema.Schema
}

// New creates the directory if needed and compiles the embedded schema.
func New(dir string) (*Store, error) {
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return nil, fmt.Errorf("creating dashboards directory: %w", err)
	}
	compiled, err := compileSchema()
	if err != nil {
		return nil, err
	}
	return &Store{dir: dir, schema: compiled}, nil
}

// Dir returns the dashboards directory path.
func (s *Store) Dir() string {
	return s.dir
}

// checkName guards against path traversal and hidden files. A dashboard
// name maps directly to a file name, optionally inside ONE subdirectory
// ("folder/name") — the folder is pure file organization, git-style;
// metadata.name stays the base name.
func checkName(name string) error {
	segments := strings.Split(name, "/")
	if len(segments) > 2 {
		return fmt.Errorf("invalid dashboard name %q: at most one folder level", name)
	}
	for _, segment := range segments {
		if segment == "" || strings.HasPrefix(segment, ".") ||
			strings.Contains(segment, "..") || strings.ContainsAny(segment, `\`) {
			return fmt.Errorf("invalid dashboard name %q", name)
		}
	}
	return nil
}

// baseName returns the identity part of a dashboard name (metadata.name).
func baseName(name string) string {
	if index := strings.LastIndex(name, "/"); index >= 0 {
		return name[index+1:]
	}
	return name
}

// resolve finds the file backing a dashboard name, trying each supported
// extension.
func (s *Store) resolve(name string) (path string, format Format, err error) {
	if err := checkName(name); err != nil {
		return "", "", err
	}
	for _, ext := range candidateExtensions {
		candidate := filepath.Join(s.dir, name+ext)
		if _, statErr := os.Stat(candidate); statErr == nil {
			format, _ := formatForExtension(ext)
			return candidate, format, nil
		}
	}
	return "", "", ErrNotFound
}

// List scans the directory (and one level of subdirectories, exposed as
// folders in the name: "folder/name") for dashboard files. Files that
// fail to decode or validate are flagged Invalid rather than dropped.
func (s *Store) List() ([]Info, error) {
	infos := []Info{}
	appendFile := func(prefix, fileName string) {
		format, ok := FormatForPath(fileName)
		if !ok {
			return
		}
		name := prefix + strings.TrimSuffix(fileName, filepath.Ext(fileName))
		info := Info{Name: name, Format: format}
		content, err := os.ReadFile(filepath.Join(s.dir, prefix, fileName))
		if err != nil {
			info.Invalid = true
		} else if doc, err := s.validate(content, format); err != nil {
			info.Invalid = true
		} else {
			info.DisplayName, info.Description = displayOf(doc)
		}
		infos = append(infos, info)
	}

	entries, err := os.ReadDir(s.dir)
	if err != nil {
		return nil, err
	}
	for _, entry := range entries {
		if strings.HasPrefix(entry.Name(), ".") {
			continue
		}
		if !entry.IsDir() {
			appendFile("", entry.Name())
			continue
		}
		nested, err := os.ReadDir(filepath.Join(s.dir, entry.Name()))
		if err != nil {
			continue
		}
		for _, file := range nested {
			if file.IsDir() || strings.HasPrefix(file.Name(), ".") {
				continue
			}
			appendFile(entry.Name()+"/", file.Name())
		}
	}
	sort.Slice(infos, func(i, j int) bool { return infos[i].Name < infos[j].Name })
	return infos, nil
}

func displayOf(doc map[string]any) (name, description string) {
	spec, _ := doc["spec"].(map[string]any)
	display, _ := spec["display"].(map[string]any)
	name, _ = display["name"].(string)
	description, _ = display["description"].(string)
	return name, description
}

// Exists reports whether a file backs the dashboard name, in any format.
func (s *Store) Exists(name string) bool {
	_, _, err := s.resolve(name)
	return err == nil
}

// Get returns the raw file content and its format.
func (s *Store) Get(name string) ([]byte, Format, error) {
	path, format, err := s.resolve(name)
	if err != nil {
		return nil, "", err
	}
	content, err := os.ReadFile(path)
	if err != nil {
		return nil, "", err
	}
	return content, format, nil
}

// Save validates then writes content atomically as name.<format>. The
// dashboard name is the identity: saving in a new format replaces any file
// for the same name in another format, and metadata.name must match.
func (s *Store) Save(name string, content []byte, format Format) error {
	if err := checkName(name); err != nil {
		return err
	}
	doc, err := s.validate(content, format)
	if err != nil {
		return err
	}
	metadata, _ := doc["metadata"].(map[string]any)
	if metadataName, _ := metadata["name"].(string); metadataName != baseName(name) {
		return &ValidationError{Issues: []string{fmt.Sprintf(
			"/metadata/name: %q does not match dashboard name %q", metadataName, baseName(name))}}
	}

	path := filepath.Join(s.dir, name+format.extension())
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	temp, err := os.CreateTemp(filepath.Dir(path), "."+baseName(name)+".tmp-*")
	if err != nil {
		return err
	}
	defer os.Remove(temp.Name())
	if _, err := temp.Write(content); err != nil {
		temp.Close()
		return err
	}
	if err := temp.Close(); err != nil {
		return err
	}
	if err := os.Rename(temp.Name(), path); err != nil {
		return err
	}

	// Drop leftovers in other formats so the name resolves unambiguously.
	for _, ext := range candidateExtensions {
		other := filepath.Join(s.dir, name+ext)
		if other != path {
			os.Remove(other)
		}
	}
	return nil
}

// Delete removes the file backing a dashboard name (and its folder when
// that leaves it empty).
func (s *Store) Delete(name string) error {
	path, _, err := s.resolve(name)
	if err != nil {
		return err
	}
	if err := os.Remove(path); err != nil {
		return err
	}
	if parent := filepath.Dir(path); parent != filepath.Clean(s.dir) {
		os.Remove(parent) // fails (kept) unless empty — intended
	}
	return nil
}
