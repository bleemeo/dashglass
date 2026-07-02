package store

import (
	"path/filepath"
	"strings"
)

// Format identifies a dashboard file encoding.
type Format string

const (
	FormatJSON Format = "json"
	FormatYAML Format = "yaml"
	FormatTOML Format = "toml"
)

// Formats lists supported encodings.
var Formats = []Format{FormatJSON, FormatYAML, FormatTOML}

// extension returns the canonical file extension for a format.
func (f Format) extension() string {
	return "." + string(f)
}

// candidateExtensions are every extension the store recognizes, in the
// order used to resolve a dashboard name to a file.
var candidateExtensions = []string{".json", ".yaml", ".yml", ".toml"}

// formatForExtension maps a file extension to its format.
func formatForExtension(ext string) (Format, bool) {
	switch strings.ToLower(ext) {
	case ".json":
		return FormatJSON, true
	case ".yaml", ".yml":
		return FormatYAML, true
	case ".toml":
		return FormatTOML, true
	default:
		return "", false
	}
}

// FormatForPath maps a file name/path to a format by extension.
func FormatForPath(path string) (Format, bool) {
	return formatForExtension(filepath.Ext(path))
}

// FormatForContentType maps an HTTP content type to a format.
func FormatForContentType(contentType string) (Format, bool) {
	mediaType := strings.TrimSpace(strings.Split(contentType, ";")[0])
	switch mediaType {
	case "application/json":
		return FormatJSON, true
	case "application/yaml", "application/x-yaml", "text/yaml":
		return FormatYAML, true
	case "application/toml", "text/toml":
		return FormatTOML, true
	default:
		return "", false
	}
}

// ContentType returns the HTTP content type for a format.
func (f Format) ContentType() string {
	switch f {
	case FormatJSON:
		return "application/json"
	case FormatTOML:
		return "application/toml"
	default:
		return "application/yaml"
	}
}
