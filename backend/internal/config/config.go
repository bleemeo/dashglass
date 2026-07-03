// Package config loads the optional polaris.yaml configuration file.
// Precedence: flags > environment > file > defaults (DESIGN.md §7.4);
// the file supports ${ENV_VAR} expansion so secrets stay out of it.
package config

import (
	"fmt"
	"os"
	"regexp"

	"github.com/goccy/go-yaml"
)

type Config struct {
	Listen     string `yaml:"listen"`
	Prometheus struct {
		URL string `yaml:"url"`
	} `yaml:"prometheus"`
	Dashboards struct {
		Dir      string `yaml:"dir"`
		Readonly bool   `yaml:"readonly"`
	} `yaml:"dashboards"`
	GrafanaCom struct {
		Disable bool `yaml:"disable"`
	} `yaml:"grafana_com"`
	Auth struct {
		// Server-managed state (users, mappings, session secret).
		File string `yaml:"file"`
	} `yaml:"auth"`
}

// Defaults returns the built-in configuration.
func Defaults() Config {
	cfg := Config{}
	cfg.Listen = ":8080"
	cfg.Dashboards.Dir = "./dashboards"
	cfg.Auth.File = "./auth.yaml"
	return cfg
}

var envPattern = regexp.MustCompile(`\$\{([A-Za-z_][A-Za-z0-9_]*)\}`)

// expandEnv substitutes ${VAR} references; unset variables expand empty.
func expandEnv(content []byte) []byte {
	return envPattern.ReplaceAllFunc(content, func(match []byte) []byte {
		name := envPattern.FindSubmatch(match)[1]
		return []byte(os.Getenv(string(name)))
	})
}

// Load reads path over the defaults; a missing file is an error (the flag
// explicitly asked for it), but an empty path returns the defaults.
func Load(path string) (Config, error) {
	cfg := Defaults()
	if path == "" {
		return cfg, nil
	}
	content, err := os.ReadFile(path)
	if err != nil {
		return cfg, fmt.Errorf("reading config: %w", err)
	}
	if err := yaml.UnmarshalWithOptions(expandEnv(content), &cfg, yaml.Strict()); err != nil {
		return cfg, fmt.Errorf("parsing %s: %w", path, err)
	}
	return cfg, nil
}
