// Polaris backend: serves the embedded SPA, proxies Prometheus and manages
// the dashboards directory (see DESIGN.md §4).
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
	"syscall"
	"time"

	"github.com/bleemeo/polarisui/backend/internal/api"
	"github.com/bleemeo/polarisui/backend/internal/store"
	"github.com/bleemeo/polarisui/backend/internal/ui"
	"github.com/bleemeo/polarisui/backend/internal/watch"
)

// version is set at build time with -ldflags "-X main.version=...".
var version = "dev"

func main() {
	listen := flag.String("listen", ":8080", "listen address")
	prometheusURL := flag.String("prometheus-url", "", "Prometheus base URL (credentials as URL userinfo stay server-side)")
	dashboardsDir := flag.String("dashboards-dir", "./dashboards", "directory holding dashboard files")
	readonly := flag.Bool("readonly", false, "provisioned mode: dashboards are managed by git only, the API refuses writes")
	flag.Parse()

	logger := slog.New(slog.NewTextHandler(os.Stderr, nil))
	if err := run(*listen, *prometheusURL, *dashboardsDir, *readonly, logger); err != nil {
		logger.Error("fatal", "error", err)
		os.Exit(1)
	}
}

func run(listen, prometheusURL, dashboardsDir string, readonly bool, logger *slog.Logger) error {
	dashboardStore, err := store.New(dashboardsDir)
	if err != nil {
		return err
	}

	var target *url.URL
	if prometheusURL != "" {
		target, err = url.Parse(prometheusURL)
		if err != nil || target.Scheme == "" || target.Host == "" {
			return fmt.Errorf("invalid -prometheus-url %q", prometheusURL)
		}
	} else {
		logger.Warn("no -prometheus-url configured, metric queries will fail")
	}

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	hub := watch.NewHub()
	if err := watch.Watch(ctx, dashboardStore.Dir(), hub, logger); err != nil {
		return fmt.Errorf("watching dashboards directory: %w", err)
	}

	mux := http.NewServeMux()
	api.New(api.Options{
		Store:         dashboardStore,
		Hub:           hub,
		PrometheusURL: target,
		Readonly:      readonly,
		Version:       version,
	}).Routes(mux)
	mux.Handle("/", ui.Handler())

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
		"prometheus", prometheusURL, "readonly", readonly, "version", version)
	if err := server.ListenAndServe(); !errors.Is(err, http.ErrServerClosed) {
		return err
	}
	return nil
}
