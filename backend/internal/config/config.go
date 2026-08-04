// Package config loads the optional dashglass.yaml configuration file.
// Precedence: flags > environment > file > defaults (DESIGN.md §7.4);
// the file supports ${ENV_VAR} expansion so secrets stay out of it.
package config

import (
	"fmt"
	"os"
	"regexp"

	"github.com/goccy/go-yaml"

	"github.com/bleemeo/dashglass/backend/internal/auth"
)

type Config struct {
	Listen     string           `yaml:"listen"`
	Prometheus PrometheusConfig `yaml:"prometheus"`
	Dashboards struct {
		Dir      string `yaml:"dir"`
		Readonly bool   `yaml:"readonly"`
	} `yaml:"dashboards"`
	GrafanaCom struct {
		Disable bool `yaml:"disable"`
	} `yaml:"grafana_com"`
	Git struct {
		// CommitOnSave records every UI dashboard write as a local git
		// commit authored by the acting user (requires the dashboards
		// directory inside a git work tree).
		CommitOnSave bool `yaml:"commit_on_save"`
		// Remote enables push/pull sync with a git remote (HTTPS +
		// token). Provisioning it here locks the admin UI, like the
		// Prometheus URL.
		Remote GitRemoteConfig `yaml:"remote"`
	} `yaml:"git"`
	Auth struct {
		// Server-managed state (users, mappings, session secret).
		File string `yaml:"file"`
		// Trusted reverse-proxy authentication (DESIGN.md §7.4 phase 2).
		Proxy auth.ProxyConfig `yaml:"proxy"`
		// Native OpenID Connect login (DESIGN.md §7.4 phase 3).
		OIDC auth.OIDCConfig `yaml:"oidc"`
	} `yaml:"auth"`
}

// PrometheusConfig provisions the datasource from dashglass.yaml.
type PrometheusConfig struct {
	URL string `yaml:"url"`
	// Extra headers sent with every upstream request (e.g.
	// X-Scope-OrgID for Mimir/Cortex tenancy).
	Headers map[string]string `yaml:"headers"`
	// CAFile adds a PEM CA bundle to trust for the upstream TLS
	// connection (self-signed or private-CA deployments).
	CAFile string `yaml:"ca_file"`
	// ClientCertFile/ClientKeyFile enable mTLS towards Prometheus.
	ClientCertFile string `yaml:"client_cert_file"`
	ClientKeyFile  string `yaml:"client_key_file"`
	// InsecureSkipVerify disables upstream TLS verification — last
	// resort; prefer ca_file.
	InsecureSkipVerify bool `yaml:"insecure_skip_verify"`
}

// GitRemoteConfig provisions the git sync remote from dashglass.yaml.
type GitRemoteConfig struct {
	URL      string `yaml:"url"`
	Username string `yaml:"username"`
	Token    string `yaml:"token"`
	// SSHKeyFile is the private-key path for ssh remotes (a mounted
	// deploy key, for instance).
	SSHKeyFile string `yaml:"ssh_key_file"`
	// Interval between pull cycles (Go duration, default 60s); pushes
	// happen right after each commit-on-save.
	Interval string `yaml:"interval"`
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
