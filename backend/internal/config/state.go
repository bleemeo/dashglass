package config

import (
	"fmt"
	"os"
	"path/filepath"

	"github.com/goccy/go-yaml"
)

// State is the server-managed runtime configuration: settings an admin
// edits from the UI, persisted next to auth.yaml. It only ever covers
// settings NOT provisioned through flags/env/file — provisioned values
// stay read-only in the UI (the deployment owns them).
type State struct {
	Prometheus PrometheusState `yaml:"prometheus,omitempty"`
	Git        GitState        `yaml:"git,omitempty"`
}

// GitState is the UI-configured git remote for push/pull sync.
type GitState struct {
	RemoteURL string `yaml:"remote_url,omitempty"`
	Username  string `yaml:"username,omitempty"`
	Token     string `yaml:"token,omitempty"`
	// SSHKeyFile points at the pasted private key (written 0600 next to
	// this state file) for ssh remotes.
	SSHKeyFile string `yaml:"ssh_key_file,omitempty"`
	// IntervalSeconds between pull cycles (0 = default).
	IntervalSeconds int `yaml:"interval_seconds,omitempty"`
}

// PrometheusState is the UI-configured Prometheus connection.
type PrometheusState struct {
	URL string `yaml:"url,omitempty"`
	// Exactly one auth mode is set: basic (username+password) or bearer.
	BasicUsername string `yaml:"basic_username,omitempty"`
	BasicPassword string `yaml:"basic_password,omitempty"`
	BearerToken   string `yaml:"bearer_token,omitempty"`
	// Extra headers sent with every upstream request.
	Headers map[string]string `yaml:"headers,omitempty"`
	// TLS material is stored inline as PEM (the file is 0600, next to
	// auth.yaml): a CA bundle to trust and/or an mTLS client pair.
	CACert             string `yaml:"ca_cert,omitempty"`
	ClientCert         string `yaml:"client_cert,omitempty"`
	ClientKey          string `yaml:"client_key,omitempty"`
	InsecureSkipVerify bool   `yaml:"insecure_skip_verify,omitempty"`
}

// StatePath derives the state-file location from the auth file: both are
// server-managed state and live together (e.g. /data in the container).
func StatePath(authFile string) string {
	return filepath.Join(filepath.Dir(authFile), "settings.yaml")
}

// SSHKeyPath is where a UI-pasted git SSH key is persisted (0600).
func SSHKeyPath(stateFile string) string {
	return filepath.Join(filepath.Dir(stateFile), "git_ssh_key")
}

// KnownHostsPath is the dashglass-managed known-hosts file for git-over-
// SSH: host keys get pinned there first-use, not in the user's ~/.ssh.
func KnownHostsPath(stateFile string) string {
	return filepath.Join(filepath.Dir(stateFile), "git_known_hosts")
}

// LoadState reads the state file; a missing file is an empty state.
func LoadState(path string) (State, error) {
	var state State
	content, err := os.ReadFile(path)
	if os.IsNotExist(err) {
		return state, nil
	}
	if err != nil {
		return state, fmt.Errorf("reading state: %w", err)
	}
	if err := yaml.UnmarshalWithOptions(content, &state, yaml.Strict()); err != nil {
		return state, fmt.Errorf("parsing %s: %w", path, err)
	}
	return state, nil
}

// SaveState writes the state file atomically, owner-only (it holds
// credentials).
func SaveState(path string, state State) error {
	content, err := yaml.Marshal(state)
	if err != nil {
		return fmt.Errorf("encoding state: %w", err)
	}
	temp := path + ".tmp"
	if err := os.WriteFile(temp, content, 0o600); err != nil {
		return fmt.Errorf("writing state: %w", err)
	}
	if err := os.Rename(temp, path); err != nil {
		return fmt.Errorf("writing state: %w", err)
	}
	return nil
}
