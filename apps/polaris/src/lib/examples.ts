import { dashboardSchema, type Dashboard } from "@polarisui/model";

/** A ready-made dashboard offered from the empty state. */
export interface DashboardExample {
  /** File name / identifier. */
  key: string;
  title: string;
  description: string;
  build: () => Dashboard;
}

function timeSeriesPanel(name: string, query: string, extra?: Record<string, unknown>) {
  return {
    kind: "Panel",
    spec: {
      display: { name },
      plugin: { kind: "TimeSeriesChart", spec: extra ?? {} },
      queries: [
        {
          kind: "TimeSeriesQuery",
          spec: {
            plugin: { kind: "PrometheusTimeSeriesQuery", spec: { query } },
          },
        },
      ],
    },
  };
}

function statPanel(name: string, query: string, spec: Record<string, unknown>) {
  return {
    kind: "Panel",
    spec: {
      display: { name },
      plugin: { kind: "StatChart", spec },
      queries: [
        {
          kind: "TimeSeriesQuery",
          spec: {
            plugin: { kind: "PrometheusTimeSeriesQuery", spec: { query } },
          },
        },
      ],
    },
  };
}

function ref(key: string) {
  return { content: { $ref: `#/spec/panels/${key}` } };
}

/**
 * A dashboard of Prometheus's own metrics. Every query targets metrics a
 * self-scraping Prometheus always exposes, so it shows real data on any
 * install out of the box — the ideal first dashboard.
 */
function prometheusOverview(): Dashboard {
  return dashboardSchema.parse({
    apiVersion: "v1",
    kind: "Dashboard",
    metadata: { name: "prometheus-overview" },
    spec: {
      display: {
        name: "Prometheus overview",
        description: "Health of your Prometheus, from its own metrics.",
      },
      panels: {
        // No threshold on "up": the model expresses "status from a value
        // upward", which can't say "warn when it drops" — so leave it
        // neutral. "down" reads naturally: 0 is good, any is critical.
        "targets-up": statPanel("Targets up", "sum(up)", { unit: "short" }),
        "targets-down": statPanel("Targets down", "sum(up == bool 0)", {
          unit: "short",
          thresholds: [{ value: 1, status: "critical" }],
        }),
        "head-series": statPanel(
          "Head series",
          "sum(prometheus_tsdb_head_series)",
          { unit: "short", sparkline: true },
        ),
        "scrape-duration": timeSeriesPanel(
          "Scrape duration",
          "scrape_duration_seconds",
          { unit: "seconds" },
        ),
        "samples-appended": timeSeriesPanel(
          "Samples appended /s",
          "rate(prometheus_tsdb_head_samples_appended_total[5m])",
          { unit: "short" },
        ),
        "http-requests": timeSeriesPanel(
          "HTTP requests /s",
          "sum by (code) (rate(prometheus_http_requests_total[5m]))",
          { unit: "short" },
        ),
      },
      layouts: [
        {
          kind: "Grid",
          spec: {
            items: [
              { x: 0, y: 0, width: 8, height: 5, ...ref("targets-up") },
              { x: 8, y: 0, width: 8, height: 5, ...ref("targets-down") },
              { x: 16, y: 0, width: 8, height: 5, ...ref("head-series") },
              { x: 0, y: 5, width: 12, height: 8, ...ref("scrape-duration") },
              { x: 12, y: 5, width: 12, height: 8, ...ref("samples-appended") },
              { x: 0, y: 13, width: 24, height: 8, ...ref("http-requests") },
            ],
          },
        },
      ],
      duration: "1h",
    },
  });
}

export const DASHBOARD_EXAMPLES: DashboardExample[] = [
  {
    key: "prometheus-overview",
    title: "Prometheus overview",
    description:
      "Targets, scrape durations and ingestion — works on any Prometheus.",
    build: prometheusOverview,
  },
];
