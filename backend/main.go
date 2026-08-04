// Dashglass backend: serves the embedded SPA, proxies Prometheus and manages
// the dashboards directory (see DESIGN.md §4 and §7.4).
package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"log/slog"
	"net/http"
	"net/url"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"github.com/bleemeo/dashglass/backend/internal/api"
	"github.com/bleemeo/dashglass/backend/internal/auth"
	"github.com/bleemeo/dashglass/backend/internal/config"
	"github.com/bleemeo/dashglass/backend/internal/history"
	"github.com/bleemeo/dashglass/backend/internal/store"
	"github.com/bleemeo/dashglass/backend/internal/ui"
	"github.com/bleemeo/dashglass/backend/internal/watch"
)

// version is set at build time with -ldflags "-X main.version=...".
var version = "dev"

// setting tracks one effective value and where it came from
// (flags > environment > file > defaults, DESIGN.md §7.4).
type setting struct {
	value  string
	source string
}

func main() {
	// Subcommands come before flags.
	if len(os.Args) > 1 {
		switch os.Args[1] {
		case "lint":
			os.Exit(runLint(os.Args[2:], os.Stdout, os.Stderr))
		case "user":
			os.Exit(runUser(os.Args[2:], os.Stdout, os.Stderr))
		case "askpass":
			// Called back by git (GIT_ASKPASS) during remote sync:
			// answers the credential prompts from the environment set in
			// history.askpassEnv — credentials never hit a command line.
			prompt := ""
			if len(os.Args) > 2 {
				prompt = os.Args[2]
			}
			if strings.HasPrefix(prompt, "Username") {
				fmt.Println(os.Getenv("DASHGLASS_ASKPASS_USERNAME"))
			} else {
				fmt.Println(os.Getenv("DASHGLASS_ASKPASS_PASSWORD"))
			}
			os.Exit(0)
		}
	}

	configPath := flag.String("config", "", "path to dashglass.yaml (optional)")
	listen := flag.String("listen", "", "listen address")
	prometheusURL := flag.String("prometheus-url", "", "Prometheus base URL (credentials as URL userinfo stay server-side)")
	dashboardsDir := flag.String("dashboards-dir", "", "directory holding dashboard files")
	readonly := flag.Bool("readonly", false, "provisioned mode: dashboards are managed by git only, the API refuses writes")
	disableGrafanaCom := flag.Bool("disable-grafana-com", false,
		"disable the grafana.com dashboard import proxy (the only outbound internet call)")
	gitCommitOnSave := flag.Bool("git-commit-on-save", false,
		"record every UI dashboard write as a git commit authored by the acting user")
	flag.Parse()

	logger := slog.New(slog.NewTextHandler(os.Stderr, nil))

	if *configPath == "" {
		*configPath = os.Getenv("DASHGLASS_CONFIG")
	}
	cfg, err := config.Load(*configPath)
	if err != nil {
		logger.Error("fatal", "error", err)
		os.Exit(1)
	}
	defaults := config.Defaults()

	// Effective settings with provenance, for the admin configuration view.
	resolve := func(key, fileValue, defaultValue, envName string, flagValue string, flagSet bool) setting {
		result := setting{value: defaultValue, source: "default"}
		if fileValue != defaultValue {
			result = setting{value: fileValue, source: "file"}
		}
		if envValue := os.Getenv(envName); envValue != "" {
			result = setting{value: envValue, source: "env"}
		}
		if flagSet {
			result = setting{value: flagValue, source: "flag"}
		}
		return result
	}
	flagsSet := map[string]bool{}
	flag.Visit(func(f *flag.Flag) { flagsSet[f.Name] = true })
	boolString := func(b bool) string {
		if b {
			return "true"
		}
		return "false"
	}

	settings := map[string]setting{
		"listen": resolve("listen", cfg.Listen, defaults.Listen,
			"DASHGLASS_LISTEN", *listen, flagsSet["listen"]),
		"prometheus.url": resolve("prometheus.url", cfg.Prometheus.URL, "",
			"DASHGLASS_PROMETHEUS_URL", *prometheusURL, flagsSet["prometheus-url"]),
		"dashboards.dir": resolve("dashboards.dir", cfg.Dashboards.Dir, defaults.Dashboards.Dir,
			"DASHGLASS_DASHBOARDS_DIR", *dashboardsDir, flagsSet["dashboards-dir"]),
		"dashboards.readonly": resolve("dashboards.readonly",
			boolString(cfg.Dashboards.Readonly), "false",
			"DASHGLASS_READONLY", boolString(*readonly), flagsSet["readonly"]),
		"grafana_com.disable": resolve("grafana_com.disable",
			boolString(cfg.GrafanaCom.Disable), "false",
			"DASHGLASS_DISABLE_GRAFANA_COM", boolString(*disableGrafanaCom), flagsSet["disable-grafana-com"]),
		"git.commit_on_save": resolve("git.commit_on_save",
			boolString(cfg.Git.CommitOnSave), "false",
			"DASHGLASS_GIT_COMMIT_ON_SAVE", boolString(*gitCommitOnSave), flagsSet["git-commit-on-save"]),
		"auth.file": resolve("auth.file", cfg.Auth.File, defaults.Auth.File,
			"DASHGLASS_AUTH_FILE", "", false),
	}

	if err := run(settings, cfg.Prometheus, cfg.Auth.Proxy, cfg.Auth.OIDC, cfg.Git.Remote, logger); err != nil {
		logger.Error("fatal", "error", err)
		os.Exit(1)
	}
}

func run(settings map[string]setting, promConfig config.PrometheusConfig, proxyConfig auth.ProxyConfig, oidcConfig auth.OIDCConfig, gitRemoteConfig config.GitRemoteConfig, logger *slog.Logger) error {
	dashboardStore, err := store.New(settings["dashboards.dir"].value)
	if err != nil {
		return err
	}

	// UI-managed runtime settings (admin-edited datasource, git remote)
	// live in a state file next to auth.yaml.
	stateFile := config.StatePath(settings["auth.file"].value)
	runtimeState, err := config.LoadState(stateFile)
	if err != nil {
		return err
	}

	// Prometheus target: a flag/env/file URL is provisioned — the
	// deployment owns it and the admin UI shows it read-only. Otherwise
	// the state file may hold one (admin-configured at runtime).
	promProvisioned := settings["prometheus.url"].value != ""
	if !promProvisioned && (len(promConfig.Headers) > 0 || promConfig.CAFile != "" ||
		promConfig.ClientCertFile != "" || promConfig.ClientKeyFile != "" ||
		promConfig.InsecureSkipVerify) {
		// Silently dropping provisioned TLS/headers would send queries
		// without them once an admin sets a URL from the UI.
		return fmt.Errorf("dashglass.yaml sets prometheus headers/TLS options " +
			"but no prometheus.url: provision the URL too, or configure the " +
			"whole datasource from the admin UI")
	}
	var target *url.URL
	promBearer := ""
	var promHeaders map[string]string
	var promTLS api.PromTLS
	if promProvisioned {
		target, err = url.Parse(settings["prometheus.url"].value)
		if err != nil || target.Scheme == "" || target.Host == "" {
			return fmt.Errorf("invalid Prometheus URL %q", settings["prometheus.url"].value)
		}
		promHeaders = promConfig.Headers
		promTLS.InsecureSkipVerify = promConfig.InsecureSkipVerify
		// TLS material is provisioned as file paths (mounted secrets).
		for _, item := range []struct {
			path string
			into *[]byte
		}{
			{promConfig.CAFile, &promTLS.CACert},
			{promConfig.ClientCertFile, &promTLS.ClientCert},
			{promConfig.ClientKeyFile, &promTLS.ClientKey},
		} {
			if item.path == "" {
				continue
			}
			*item.into, err = os.ReadFile(item.path)
			if err != nil {
				return fmt.Errorf("prometheus TLS material: %w", err)
			}
		}
	} else if runtimeState.Prometheus.URL != "" {
		target, err = url.Parse(runtimeState.Prometheus.URL)
		if err != nil || target.Scheme == "" || target.Host == "" {
			return fmt.Errorf("invalid Prometheus URL %q in %s", runtimeState.Prometheus.URL, stateFile)
		}
		if runtimeState.Prometheus.BasicUsername != "" {
			target.User = url.UserPassword(
				runtimeState.Prometheus.BasicUsername, runtimeState.Prometheus.BasicPassword)
		}
		promBearer = runtimeState.Prometheus.BearerToken
		promHeaders = runtimeState.Prometheus.Headers
		promTLS = api.PromTLS{
			InsecureSkipVerify: runtimeState.Prometheus.InsecureSkipVerify,
			CACert:             []byte(runtimeState.Prometheus.CACert),
			ClientCert:         []byte(runtimeState.Prometheus.ClientCert),
			ClientKey:          []byte(runtimeState.Prometheus.ClientKey),
		}
	}
	if target == nil {
		logger.Warn("no Prometheus URL configured, metric queries will fail (an admin can set one from the UI)")
	}
	if promTLS.InsecureSkipVerify {
		logger.Warn("prometheus.insecure_skip_verify is on: the datasource's TLS certificate " +
			"is NOT verified; prefer ca_file with the server's CA")
	}

	authStore, err := auth.NewStore(settings["auth.file"].value)
	if err != nil {
		return err
	}

	proxyAuth, err := auth.NewProxyAuthenticator(proxyConfig)
	if err != nil {
		return err
	}
	if proxyAuth != nil && proxyAuth.TrustsAnySource() {
		logger.Warn("reverse-proxy auth trusts identity headers from ANY source; " +
			"set auth.proxy.trusted_proxies unless the backend is only reachable through the proxy")
	}

	if oidcConfig.InsecureSkipVerify {
		logger.Warn("auth.oidc.insecure_skip_verify is on: the provider's TLS certificate " +
			"is NOT verified; anyone on the network path can impersonate the issuer")
	}
	ctxDiscover, cancelDiscover := context.WithTimeout(context.Background(), 15*time.Second)
	oidcAuth, err := auth.NewOIDCAuthenticator(ctxDiscover, oidcConfig)
	cancelDiscover()
	if err != nil {
		return err
	}
	if oidcAuth != nil {
		// OIDC sessions are signed with the store secret; persist it so
		// they survive restarts even with no local users.
		if err := authStore.EnsureSecret(); err != nil {
			return fmt.Errorf("persisting session secret: %w", err)
		}
		logger.Info("OpenID Connect login enabled", "issuer", oidcConfig.Issuer)
	}
	// Automated deployments can seed an admin without the UI or CLI.
	if password := os.Getenv("DASHGLASS_BOOTSTRAP_ADMIN_PASSWORD"); password != "" && !authStore.Enabled() {
		if err := authStore.Create("admin", password, auth.RoleAdmin); err != nil {
			return fmt.Errorf("bootstrapping admin user: %w", err)
		}
		logger.Info("bootstrapped the admin user from DASHGLASS_BOOTSTRAP_ADMIN_PASSWORD")
	}

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	hub := watch.NewHub()
	if err := watch.Watch(ctx, dashboardStore.Dir(), hub, logger); err != nil {
		return fmt.Errorf("watching dashboards directory: %w", err)
	}

	readonly := settings["dashboards.readonly"].value == "true"
	grafanaComURL := "https://grafana.com"
	if settings["grafana_com.disable"].value == "true" {
		grafanaComURL = ""
	}

	apiSettings := make([]api.Setting, 0, len(settings))
	for _, key := range []string{
		"listen", "prometheus.url", "dashboards.dir", "dashboards.readonly",
		"grafana_com.disable", "git.commit_on_save", "auth.file",
	} {
		apiSettings = append(apiSettings, api.Setting{
			Key:    key,
			Value:  settings[key].value,
			Source: settings[key].source,
		})
	}
	// Proxy auth is file-only; surface it in the config view when set.
	if proxyConfig.UserHeader != "" {
		apiSettings = append(apiSettings,
			api.Setting{Key: "auth.proxy.user_header", Value: proxyConfig.UserHeader, Source: "file"},
			api.Setting{Key: "auth.proxy.groups_header", Value: proxyConfig.GroupsHeader, Source: "file"},
			api.Setting{Key: "auth.proxy.trusted_proxies", Value: strings.Join(proxyConfig.TrustedProxies, ", "), Source: "file"},
		)
	}
	if oidcConfig.Issuer != "" {
		apiSettings = append(apiSettings,
			api.Setting{Key: "auth.oidc.issuer", Value: oidcConfig.Issuer, Source: "file"},
			api.Setting{Key: "auth.oidc.client_id", Value: oidcConfig.ClientID, Source: "file"},
			api.Setting{Key: "auth.oidc.client_secret", Value: oidcConfig.ClientSecret, Source: "file", Secret: true},
			api.Setting{Key: "auth.oidc.redirect_url", Value: oidcConfig.RedirectURL, Source: "file"},
		)
	}

	// Git history: available whenever the dashboards directory lives
	// inside a git work tree (the GitOps setup this tool is for).
	historyService := history.Detect(dashboardStore.Dir())
	if historyService == nil {
		logger.Info("dashboard history disabled (dashboards directory is not in a git work tree)")
	}
	commitOnSave := settings["git.commit_on_save"].value == "true"
	if commitOnSave && historyService == nil {
		logger.Warn("git.commit_on_save ignored: the dashboards directory is not in a git work tree")
		commitOnSave = false
	}

	// Git remote sync: a dashglass.yaml remote is provisioned (locked in
	// the UI); otherwise the state file may hold an admin-configured one.
	gitProvisioned := gitRemoteConfig.URL != ""
	var syncer *history.Syncer
	if historyService != nil {
		var remote *history.Remote
		interval := history.DefaultSyncInterval
		if gitProvisioned {
			remote = &history.Remote{
				URL:               gitRemoteConfig.URL,
				Username:          gitRemoteConfig.Username,
				Password:          gitRemoteConfig.Token,
				SSHKeyFile:        gitRemoteConfig.SSHKeyFile,
				SSHKnownHostsFile: config.KnownHostsPath(stateFile),
			}
			if gitRemoteConfig.Interval != "" {
				parsed, err := time.ParseDuration(gitRemoteConfig.Interval)
				if err != nil {
					return fmt.Errorf("invalid git.remote.interval %q", gitRemoteConfig.Interval)
				}
				interval = parsed
			}
			apiSettings = append(apiSettings,
				api.Setting{Key: "git.remote.url", Value: gitRemoteConfig.URL, Source: "file"},
				api.Setting{Key: "git.remote.token", Value: gitRemoteConfig.Token, Source: "file", Secret: true},
			)
		} else if runtimeState.Git.RemoteURL != "" {
			remote = &history.Remote{
				URL:               runtimeState.Git.RemoteURL,
				Username:          runtimeState.Git.Username,
				Password:          runtimeState.Git.Token,
				SSHKeyFile:        runtimeState.Git.SSHKeyFile,
				SSHKnownHostsFile: config.KnownHostsPath(stateFile),
			}
			if runtimeState.Git.IntervalSeconds > 0 {
				interval = time.Duration(runtimeState.Git.IntervalSeconds) * time.Second
			}
		}
		syncer = history.NewSyncer(historyService, remote, interval)
		if remote != nil {
			logger.Info("git sync enabled", "remote", remote.URL, "interval", interval)
		}
	} else if gitProvisioned {
		logger.Warn("git.remote ignored: the dashboards directory is not in a git work tree")
	}
	if syncer != nil {
		go syncer.Run(ctx)
	}

	mux := http.NewServeMux()
	apiServer, err := api.New(api.Options{
		Store:                 dashboardStore,
		Hub:                   hub,
		PrometheusURL:         target,
		PrometheusBearer:      promBearer,
		PrometheusHeaders:     promHeaders,
		PrometheusTLS:         promTLS,
		PrometheusProvisioned: promProvisioned,
		StateFile:             stateFile,
		Readonly:              readonly,
		Version:               version,
		GrafanaComURL:         grafanaComURL,
		Auth:                  authStore,
		ProxyAuth:             proxyAuth,
		OIDC:                  oidcAuth,
		Settings:              apiSettings,
		Logger:                logger,
		History:               historyService,
		CommitOnSave:          commitOnSave,
		Syncer:                syncer,
		GitProvisioned:        gitProvisioned,
	})
	if err != nil {
		return err
	}
	apiServer.Routes(mux)
	mux.Handle("/", ui.Handler())

	listen := settings["listen"].value
	server := &http.Server{
		Addr:              listen,
		Handler:           mux,
		ReadHeaderTimeout: 10 * time.Second,
		// No WriteTimeout: /api/events is a long-lived SSE stream.
	}

	go func() {
		<-ctx.Done()
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		server.Shutdown(shutdownCtx)
	}()

	logger.Info("dashglass backend listening",
		"address", listen, "dashboards", dashboardStore.Dir(),
		"prometheus", settings["prometheus.url"].value,
		"readonly", readonly, "auth", authStore.Enabled(), "version", version)
	if err := server.ListenAndServe(); !errors.Is(err, http.ErrServerClosed) {
		return err
	}
	return nil
}
