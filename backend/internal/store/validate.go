package store

import (
	"bytes"
	"encoding/json"
	"fmt"
	"strings"

	"github.com/goccy/go-yaml"
	toml "github.com/pelletier/go-toml/v2"
	"github.com/santhosh-tekuri/jsonschema/v6"
	"golang.org/x/text/language"
	"golang.org/x/text/message"

	"github.com/bleemeo/dashglass/backend/schema"
)

// ValidationError carries the individual issues found in a document so the
// API can return them to the editing UI.
type ValidationError struct {
	Issues []string
}

func (e *ValidationError) Error() string {
	return "invalid dashboard: " + strings.Join(e.Issues, "; ")
}

func compileSchema() (*jsonschema.Schema, error) {
	doc, err := jsonschema.UnmarshalJSON(bytes.NewReader(schema.Dashboard))
	if err != nil {
		return nil, fmt.Errorf("parsing embedded dashboard schema: %w", err)
	}
	compiler := jsonschema.NewCompiler()
	if err := compiler.AddResource("dashboard.schema.json", doc); err != nil {
		return nil, err
	}
	return compiler.Compile("dashboard.schema.json")
}

// decode parses content in the given format into JSON-shaped Go values
// (map[string]any / []any / json.Number), the representation the JSON
// Schema validator expects.
func decode(content []byte, format Format) (any, error) {
	var doc any
	switch format {
	case FormatJSON:
		// Straight to the validator-friendly representation.
		return jsonschema.UnmarshalJSON(bytes.NewReader(content))
	case FormatYAML:
		if err := yaml.Unmarshal(content, &doc); err != nil {
			return nil, err
		}
	case FormatTOML:
		if err := toml.Unmarshal(content, &doc); err != nil {
			return nil, err
		}
	default:
		return nil, fmt.Errorf("unsupported format %q", format)
	}
	// Round-trip through JSON to normalize numeric types and nested maps.
	normalized, err := json.Marshal(doc)
	if err != nil {
		return nil, err
	}
	return jsonschema.UnmarshalJSON(bytes.NewReader(normalized))
}

// migrate mirrors packages/model migrations: documents that predate the
// apiVersion field are treated as v1.
func migrate(doc any) any {
	if object, ok := doc.(map[string]any); ok {
		if _, ok := object["apiVersion"]; !ok {
			object["apiVersion"] = "v1"
		}
	}
	return doc
}

// validate decodes, migrates and validates a dashboard document, returning
// the decoded form. It combines JSON Schema validation with the cross-field
// checks the schema cannot express (layout $ref targets, variable name
// uniqueness) — keep those in sync with packages/model.
func (s *Store) validate(content []byte, format Format) (map[string]any, error) {
	return validateContent(s.schema, content, format)
}

func validateContent(schema *jsonschema.Schema, content []byte, format Format) (map[string]any, error) {
	doc, err := decode(content, format)
	if err != nil {
		return nil, &ValidationError{Issues: []string{fmt.Sprintf("%s syntax: %v", format, err)}}
	}
	doc = migrate(doc)
	if err := schema.Validate(doc); err != nil {
		return nil, &ValidationError{Issues: schemaIssues(err)}
	}
	object := doc.(map[string]any) // guaranteed by schema: root is an object
	if issues := crossFieldIssues(object); len(issues) > 0 {
		return nil, &ValidationError{Issues: issues}
	}
	return object, nil
}

// Validator checks dashboard documents without a backing directory —
// the `dashglass lint` path, where files come from the CLI arguments.
type Validator struct {
	schema *jsonschema.Schema
}

func NewValidator() (*Validator, error) {
	schema, err := compileSchema()
	if err != nil {
		return nil, err
	}
	return &Validator{schema: schema}, nil
}

// Validate returns nil for a valid document, or a *ValidationError
// listing every issue found.
func (v *Validator) Validate(content []byte, format Format) error {
	_, err := validateContent(v.schema, content, format)
	return err
}

// schemaIssues flattens a jsonschema validation error into messages.
func schemaIssues(err error) []string {
	validationErr, ok := err.(*jsonschema.ValidationError)
	if !ok {
		return []string{err.Error()}
	}
	printer := message.NewPrinter(language.English)
	var issues []string
	var walk func(e *jsonschema.ValidationError)
	walk = func(e *jsonschema.ValidationError) {
		if len(e.Causes) == 0 {
			location := "/" + strings.Join(e.InstanceLocation, "/")
			issues = append(issues, fmt.Sprintf("%s: %s", location, e.ErrorKind.LocalizedString(printer)))
			return
		}
		for _, cause := range e.Causes {
			walk(cause)
		}
	}
	walk(validationErr)
	return issues
}

const panelRefPrefix = "#/spec/panels/"

func crossFieldIssues(doc map[string]any) []string {
	var issues []string
	spec, _ := doc["spec"].(map[string]any)
	if spec == nil {
		return nil
	}

	panels, _ := spec["panels"].(map[string]any)
	if layouts, ok := spec["layouts"].([]any); ok {
		for layoutIndex, rawLayout := range layouts {
			layout, _ := rawLayout.(map[string]any)
			layoutSpec, _ := layout["spec"].(map[string]any)
			items, _ := layoutSpec["items"].([]any)
			for itemIndex, rawItem := range items {
				item, _ := rawItem.(map[string]any)
				content, _ := item["content"].(map[string]any)
				ref, _ := content["$ref"].(string)
				key := strings.TrimPrefix(ref, panelRefPrefix)
				if _, ok := panels[key]; !ok {
					issues = append(issues, fmt.Sprintf(
						"/spec/layouts/%d/spec/items/%d/content/$ref: layout item references unknown panel %q",
						layoutIndex, itemIndex, key))
				}
			}
		}
	}

	variableNames := map[string]bool{}
	if variables, ok := spec["variables"].([]any); ok {
		for index, rawVariable := range variables {
			variable, _ := rawVariable.(map[string]any)
			variableSpec, _ := variable["spec"].(map[string]any)
			name, _ := variableSpec["name"].(string)
			if variableNames[name] {
				issues = append(issues, fmt.Sprintf(
					"/spec/variables/%d/spec/name: duplicate variable name %q", index, name))
			}
			variableNames[name] = true
		}
	}

	// A panel's repeat must target a variable declared on the dashboard.
	for key, rawPanel := range panels {
		panel, _ := rawPanel.(map[string]any)
		panelSpec, _ := panel["spec"].(map[string]any)
		repeat, ok := panelSpec["repeat"].(map[string]any)
		if !ok {
			continue
		}
		variable, _ := repeat["variable"].(string)
		if !variableNames[variable] {
			issues = append(issues, fmt.Sprintf(
				"/spec/panels/%s/spec/repeat/variable: panel repeats over unknown variable %q",
				key, variable))
		}
	}

	return issues
}
