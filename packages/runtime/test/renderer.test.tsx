import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { Dashboard, Panel } from "@dashglass/model";

import {
  DashboardGrid,
  DashboardRenderer,
  RuntimeProvider,
  TimeRangeProvider,
  VariablesProvider,
  createRegistries,
  panelPromQL,
  useVariables,
  type PanelProps,
  type PromResponse,
  type PrometheusDataSource,
} from "../src";

function matrixResponse(instance: string): PromResponse {
  return {
    status: "success",
    data: {
      resultType: "matrix",
      result: [
        { metric: { __name__: "up", instance }, values: [[100, "1"]] },
      ],
    },
  };
}

function testDashboard(): Dashboard {
  return {
    apiVersion: "v1",
    kind: "Dashboard",
    metadata: { name: "test" },
    spec: {
      variables: [
        {
          kind: "ListVariable",
          spec: {
            name: "instance",
            plugin: { kind: "TestVariableSource" },
          },
        },
      ],
      panels: {
        cpu: {
          kind: "Panel",
          spec: {
            display: {
              name: "CPU usage",
              description: "Busy time on $instance, excluding iowait",
            },
            plugin: { kind: "TestChart" },
            queries: [
              {
                kind: "TimeSeriesQuery",
                spec: {
                  plugin: {
                    kind: "PrometheusTimeSeriesQuery",
                    spec: { query: 'up{instance="$instance"}' },
                  },
                },
              },
            ],
          },
        },
        mystery: {
          kind: "Panel",
          spec: { plugin: { kind: "ProprietaryPanel" } },
        },
      },
      layouts: [
        {
          kind: "Grid",
          spec: {
            display: { title: "System" },
            items: [
              {
                x: 0,
                y: 0,
                width: 12,
                height: 8,
                content: { $ref: "#/spec/panels/cpu" },
              },
              {
                x: 12,
                y: 0,
                width: 12,
                height: 8,
                content: { $ref: "#/spec/panels/mystery" },
              },
            ],
          },
        },
      ],
    },
  };
}

describe("DashboardRenderer", () => {
  it("renders panels with interpolated queries and flags unknown kinds", async () => {
    const seenQueries: string[] = [];
    const datasource: PrometheusDataSource = {
      rangeQuery: async (params) => {
        seenQueries.push(params.query);
        return matrixResponse("web-1");
      },
      instantQuery: vi.fn(),
      labelNames: vi.fn(),
      labelValues: vi.fn(),
    };

    const registries = createRegistries();
    registries.panels.register({
      kind: "TestChart",
      component: ({ data }: PanelProps) => (
        <ul>
          {data.series.map((series) => (
            <li key={series.name}>
              {series.name}: {series.points[0]?.[1]}
            </li>
          ))}
        </ul>
      ),
    });
    registries.variableSources.register({
      kind: "TestVariableSource",
      loadValues: async () => ["web-1", "web-2"],
    });

    render(
      <RuntimeProvider datasource={datasource} registries={registries}>
        <TimeRangeProvider>
          <DashboardRenderer dashboard={testDashboard()} />
        </TimeRangeProvider>
      </RuntimeProvider>,
    );

    // Section title and panel titles come from the model.
    expect(await screen.findByText("System")).toBeDefined();
    expect(screen.getByText("CPU usage")).toBeDefined();

    // The query ran with the variable interpolated to its first value.
    expect(
      await screen.findByText('up{instance="web-1"}: 1'),
    ).toBeDefined();
    expect(seenQueries).toEqual(['up{instance="web-1"}']);

    // The description surfaces as a tooltip marker, with variables
    // interpolated like the title. Panels without one get no marker.
    const marker = screen.getByLabelText(
      "Description: Busy time on web-1, excluding iowait",
    );
    expect(marker.getAttribute("title")).toBe(
      "Busy time on web-1, excluding iowait",
    );
    expect(document.querySelectorAll(".dashglass-panel-description")).toHaveLength(
      1,
    );

    // Unknown (e.g. proprietary) panel kinds degrade gracefully.
    expect(
      screen.getByText(/Unknown panel kind “ProprietaryPanel”/),
    ).toBeDefined();
  });

  it("shows query errors in the panel chrome", async () => {
    const datasource: PrometheusDataSource = {
      rangeQuery: async () => ({
        status: "error",
        error: "many-to-many matching not allowed",
      }),
      instantQuery: vi.fn(),
      labelNames: vi.fn(),
      labelValues: vi.fn(),
    };
    const registries = createRegistries();
    registries.panels.register({ kind: "TestChart", component: () => null });
    registries.variableSources.register({
      kind: "TestVariableSource",
      loadValues: async () => ["web-1"],
    });

    render(
      <RuntimeProvider datasource={datasource} registries={registries}>
        <TimeRangeProvider>
          <DashboardRenderer dashboard={testDashboard()} />
        </TimeRangeProvider>
      </RuntimeProvider>,
    );

    expect(
      await screen.findByText("many-to-many matching not allowed"),
    ).toBeDefined();
  });
});

function readingDatasource(seenQueries: string[]): PrometheusDataSource {
  return {
    rangeQuery: async (params) => {
      seenQueries.push(params.query);
      return matrixResponse("x");
    },
    instantQuery: vi.fn(),
    labelNames: vi.fn(),
    labelValues: vi.fn(),
  };
}

describe("panel repeat", () => {
  it("renders one panel per value, each with its own pinned query and title", async () => {
    const seenQueries: string[] = [];
    const registries = createRegistries();
    registries.panels.register({ kind: "TestChart", component: () => null });
    registries.variableSources.register({
      kind: "TestVariableSource",
      loadValues: async () => ["web-1", "web-2"],
    });

    const dashboard: Dashboard = {
      apiVersion: "v1",
      kind: "Dashboard",
      metadata: { name: "repeat" },
      spec: {
        variables: [
          {
            kind: "ListVariable",
            spec: {
              name: "instance",
              allowAllValue: true,
              plugin: { kind: "TestVariableSource" },
            },
          },
        ],
        panels: {
          cpu: {
            kind: "Panel",
            spec: {
              display: { name: "CPU $instance" },
              plugin: { kind: "TestChart" },
              repeat: { variable: "instance" },
              queries: [
                {
                  kind: "TimeSeriesQuery",
                  spec: {
                    plugin: {
                      kind: "PrometheusTimeSeriesQuery",
                      spec: { query: 'up{instance="$instance"}' },
                    },
                  },
                },
              ],
            },
          },
        },
        layouts: [
          {
            kind: "Grid",
            spec: {
              items: [
                {
                  x: 0,
                  y: 0,
                  width: 12,
                  height: 8,
                  content: { $ref: "#/spec/panels/cpu" },
                },
              ],
            },
          },
        ],
      },
    };

    render(
      <RuntimeProvider
        datasource={readingDatasource(seenQueries)}
        registries={registries}
      >
        <TimeRangeProvider>
          <DashboardRenderer dashboard={dashboard} />
        </TimeRangeProvider>
      </RuntimeProvider>,
    );

    // "All" (allowAllValue) repeats over every option; each instance labels
    // itself with its pinned value.
    expect(await screen.findByText("CPU web-1")).toBeDefined();
    expect(screen.getByText("CPU web-2")).toBeDefined();
    await waitFor(() =>
      expect([...seenQueries].sort()).toEqual([
        'up{instance="web-1"}',
        'up{instance="web-2"}',
      ]),
    );
  });
});

describe("panel data links", () => {
  it("interpolates variables and the time range into the link URL", async () => {
    const registries = createRegistries();
    registries.panels.register({ kind: "TestChart", component: () => null });
    registries.variableSources.register({
      kind: "TestVariableSource",
      loadValues: async () => ["web-1"],
    });

    const dashboard: Dashboard = {
      apiVersion: "v1",
      kind: "Dashboard",
      metadata: { name: "links" },
      spec: {
        variables: [
          {
            kind: "ListVariable",
            spec: { name: "instance", plugin: { kind: "TestVariableSource" } },
          },
        ],
        panels: {
          cpu: {
            kind: "Panel",
            spec: {
              display: { name: "CPU" },
              plugin: { kind: "TestChart" },
              links: [
                { title: "Detail", url: "/d/host?i=$instance&from=$__from" },
              ],
            },
          },
        },
        layouts: [
          {
            kind: "Grid",
            spec: {
              items: [
                {
                  x: 0,
                  y: 0,
                  width: 12,
                  height: 8,
                  content: { $ref: "#/spec/panels/cpu" },
                },
              ],
            },
          },
        ],
      },
    };

    render(
      <RuntimeProvider
        datasource={readingDatasource([])}
        registries={registries}
      >
        <TimeRangeProvider>
          <DashboardRenderer dashboard={dashboard} />
        </TimeRangeProvider>
      </RuntimeProvider>,
    );

    const link = (await screen.findByText("Detail")) as HTMLAnchorElement;
    expect(link.getAttribute("href")).toMatch(
      /^\/d\/host\?i=web-1&from=\d+$/,
    );
  });
});

describe("panel actions", () => {
  it("renders host controls in the header, scoped to the repeat instance", async () => {
    const registries = createRegistries();
    registries.panels.register({ kind: "TestChart", component: () => null });
    registries.variableSources.register({
      kind: "TestVariableSource",
      loadValues: async () => ["web-1", "web-2"],
    });

    const dashboard: Dashboard = {
      apiVersion: "v1",
      kind: "Dashboard",
      metadata: { name: "actions" },
      spec: {
        variables: [
          {
            kind: "ListVariable",
            spec: {
              name: "instance",
              allowAllValue: true,
              plugin: { kind: "TestVariableSource" },
            },
          },
        ],
        panels: {
          cpu: {
            kind: "Panel",
            spec: {
              plugin: { kind: "TestChart" },
              repeat: { variable: "instance" },
              queries: [
                {
                  kind: "TimeSeriesQuery",
                  spec: {
                    plugin: {
                      kind: "PrometheusTimeSeriesQuery",
                      spec: { query: 'up{instance="$instance"}' },
                    },
                  },
                },
              ],
            },
          },
        },
        layouts: [
          {
            kind: "Grid",
            spec: {
              items: [
                {
                  x: 0,
                  y: 0,
                  width: 12,
                  height: 8,
                  content: { $ref: "#/spec/panels/cpu" },
                },
              ],
            },
          },
        ],
      },
    };

    // A host action needs the panel's *resolved* query — the contract the
    // renderer promises: the node is mounted inside the panel's provider
    // scope, so it sees the pinned repeat value, not the whole selection.
    function QueryLabel({ panel }: { panel: Panel }) {
      const { values } = useVariables();
      return <span>action: {panelPromQL(panel, values).join(",")}</span>;
    }

    render(
      <RuntimeProvider
        datasource={readingDatasource([])}
        registries={registries}
      >
        <TimeRangeProvider>
          <VariablesProvider variables={dashboard.spec.variables}>
            <DashboardGrid
              dashboard={dashboard}
              renderPanelActions={({ panel }) => <QueryLabel panel={panel} />}
            />
          </VariablesProvider>
        </TimeRangeProvider>
      </RuntimeProvider>,
    );

    expect(
      await screen.findByText('action: up{instance="web-1"}'),
    ).toBeDefined();
    expect(screen.getByText('action: up{instance="web-2"}')).toBeDefined();
    expect(
      document.querySelectorAll(
        ".dashglass-panel-header .dashglass-panel-actions",
      ),
    ).toHaveLength(2);
  });
});
