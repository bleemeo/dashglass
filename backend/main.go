// Polaris backend: serves the embedded SPA, proxies Prometheus and manages
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

	"github.com/bleemeo/polarisui/backend/internal/api"
	"github.com/bleemeo/polarisui/backend/internal/auth"
	"github.com/bleemeo/polarisui/backend/internal/config"
	"github.com/bleemeo/polarisui/backend/internal/store"
	"github.com/bleemeo/polarisui/backend/internal/ui"
	"github.com/bleemeo/polarisui/backend/internal/watch"
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
		}
	}

	configPath := flag.String("config", "", "path to polaris.yaml (optional)")
	listen := flag.String("listen", "", "listen address")
	prometheusURL := flag.String("prometheus-url", "", "Prometheus base URL (credentials as URL userinfo stay server-side)")
	dashboardsDir := flag.String("dashboards-dir", "", "directory holding dashboard files")
	readonly := flag.Bool("readonly", false, "provisioned mode: dashboards are managed by git only, the API refuses writes")
	disableGrafanaCom := flag.Bool("disable-grafana-com", false,
		"disable the grafana.com dashboard import proxy (the only outbound internet call)")
	flag.Parse()

	logger := slog.New(slog.NewTextHandler(os.Stderr, nil))

	if *configPath == "" {
		*configPath = os.Getenv("POLARIS_CONFIG")
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
			"POLARIS_LISTEN", *listen, flagsSet["listen"]),
		"prometheus.url": resolve("prometheus.url", cfg.Prometheus.URL, "",
			"POLARIS_PROMETHEUS_URL", *prometheusURL, flagsSet["prometheus-url"]),
		"dashboards.dir": resolve("dashboards.dir", cfg.Dashboards.Dir, defaults.Dashboards.Dir,
			"POLARIS_DASHBOARDS_DIR", *dashboardsDir, flagsSet["dashboards-dir"]),
		"dashboards.readonly": resolve("dashboards.readonly",
			boolString(cfg.Dashboards.Readonly), "false",
			"POLARIS_READONLY", boolString(*readonly), flagsSet["readonly"]),
		"grafana_com.disable": resolve("grafana_com.disable",
			boolString(cfg.GrafanaCom.Disable), "false",
			"POLARIS_DISABLE_GRAFANA_COM", boolString(*disableGrafanaCom), flagsSet["disable-grafana-com"]),
		"auth.file": resolve("auth.file", cfg.Auth.File, defaults.Auth.File,
			"POLARIS_AUTH_FILE", "", false),
	}

	if err := run(settings, cfg.Auth.Proxy, cfg.Auth.OIDC, logger); err != nil {
		logger.Error("fatal", "error", err)
		os.Exit(1)
	}
}

func run(settings map[string]setting, proxyConfig auth.ProxyConfig, oidcConfig auth.OIDCConfig, logger *slog.Logger) error {
	dashboardStore, err := store.New(settings["dashboards.dir"].value)
	if err != nil {
		return err
	}

	var target *url.URL
	if prometheusURL := settings["prometheus.url"].value; prometheusURL != "" {
		target, err = url.Parse(prometheusURL)
		if err != nil || target.Scheme == "" || target.Host == "" {
			return fmt.Errorf("invalid Prometheus URL %q", prometheusURL)
		}
	} else {
		logger.Warn("no Prometheus URL configured, metric queries will fail")
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
	if password := os.Getenv("POLARIS_BOOTSTRAP_ADMIN_PASSWORD"); password != "" && !authStore.Enabled() {
		if err := authStore.Create("admin", password, auth.RoleAdmin); err != nil {
			return fmt.Errorf("bootstrapping admin user: %w", err)
		}
		logger.Info("bootstrapped the admin user from POLARIS_BOOTSTRAP_ADMIN_PASSWORD")
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
		"grafana_com.disable", "auth.file",
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

	mux := http.NewServeMux()
	api.New(api.Options{
		Store:         dashboardStore,
		Hub:           hub,
		PrometheusURL: target,
		Readonly:      readonly,
		Version:       version,
		GrafanaComURL: grafanaComURL,
		Auth:          authStore,
		ProxyAuth:     proxyAuth,
		OIDC:          oidcAuth,
		Settings:      apiSettings,
		Logger:        logger,
	}).Routes(mux)
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

	logger.Info("polaris backend listening",
		"address", listen, "dashboards", dashboardStore.Dir(),
		"prometheus", settings["prometheus.url"].value,
		"readonly", readonly, "auth", authStore.Enabled(), "version", version)
	if err := server.ListenAndServe(); !errors.Is(err, http.ErrServerClosed) {
		return err
	}
	return nil
}
