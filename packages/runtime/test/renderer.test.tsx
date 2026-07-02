import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { Dashboard } from "@polarisui/model";

import {
  DashboardRenderer,
  RuntimeProvider,
  TimeRangeProvider,
  createRegistries,
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
            display: { name: "CPU usage" },
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
