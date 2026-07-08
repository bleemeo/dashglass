import { dashboardSchema, type Dashboard } from "@dashglass/model";

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

function panel(
  pluginKind: string,
  name: string,
  query: string,
  spec: Record<string, unknown>,
) {
  return {
    kind: "Panel",
    spec: {
      display: { name },
      plugin: { kind: pluginKind, spec },
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
  return panel("StatChart", name, query, spec);
}

function gaugePanel(name: string, query: string, spec: Record<string, unknown>) {
  return panel("GaugeChart", name, query, spec);
}

function tablePanel(name: string, query: string, spec: Record<string, unknown>) {
  return panel("Table", name, query, spec);
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

/**
 * A closer look at the Prometheus process itself (Go runtime + per-target
 * scrape stats). Like the overview, every metric is one a self-scraping
 * Prometheus always exposes, so it has data out of the box — and it shows
 * off the threshold-colored gauge and the table's magnitude bars.
 */
function prometheusInternals(): Dashboard {
  return dashboardSchema.parse({
    apiVersion: "v1",
    kind: "Dashboard",
    metadata: { name: "prometheus-internals" },
    spec: {
      display: {
        name: "Prometheus internals",
        description: "The Prometheus process: Go runtime and scrape stats.",
      },
      panels: {
        goroutines: statPanel("Goroutines", "go_goroutines", {
          unit: "short",
          sparkline: true,
        }),
        "open-fds": statPanel("Open file descriptors", "process_open_fds", {
          unit: "short",
        }),
        // Heap occupancy is a natural 0..1 gauge; thresholds light up the
        // arc and the value as it climbs.
        "heap-usage": gaugePanel(
          "Heap in use",
          "go_memstats_heap_inuse_bytes / go_memstats_heap_sys_bytes",
          {
            unit: "percentunit",
            min: 0,
            max: 1,
            thresholds: [
              { value: 0.8, status: "warning" },
              { value: 0.95, status: "critical" },
            ],
          },
        ),
        "resident-memory": timeSeriesPanel(
          "Resident memory",
          "process_resident_memory_bytes",
          { unit: "bytes" },
        ),
        cpu: timeSeriesPanel(
          "CPU cores",
          "rate(process_cpu_seconds_total[5m])",
          { unit: "short" },
        ),
        // Per-target sample counts: the table's magnitude bars make the
        // heaviest targets pop.
        "samples-by-target": tablePanel(
          "Samples scraped by target",
          "scrape_samples_scraped",
          { unit: "short" },
        ),
      },
      layouts: [
        {
          kind: "Grid",
          spec: {
            items: [
              { x: 0, y: 0, width: 8, height: 5, ...ref("goroutines") },
              { x: 8, y: 0, width: 8, height: 5, ...ref("open-fds") },
              { x: 16, y: 0, width: 8, height: 5, ...ref("heap-usage") },
              { x: 0, y: 5, width: 12, height: 8, ...ref("resident-memory") },
              { x: 12, y: 5, width: 12, height: 8, ...ref("cpu") },
              { x: 0, y: 13, width: 24, height: 8, ...ref("samples-by-target") },
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
  {
    key: "prometheus-internals",
    title: "Prometheus internals",
    description:
      "Go runtime, memory and per-target scrape stats — works on any Prometheus.",
    build: prometheusInternals,
  },
];
