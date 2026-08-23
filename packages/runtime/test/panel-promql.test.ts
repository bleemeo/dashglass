import { describe, expect, it } from "vitest";

import type { Panel } from "@dashglass/model";

import { panelPromQL } from "../src";

function panelWithQueries(...plugins: { kind: string; spec?: unknown }[]): Panel {
  return {
    kind: "Panel",
    spec: {
      plugin: { kind: "TimeSeriesChart" },
      queries: plugins.map((plugin) => ({
        kind: "TimeSeriesQuery",
        spec: { plugin },
      })),
    },
  } as Panel;
}

describe("panelPromQL", () => {
  it("interpolates the variable values into every expression", () => {
    const panel = panelWithQueries(
      {
        kind: "PrometheusTimeSeriesQuery",
        spec: { query: 'up{instance="$instance"}' },
      },
      {
        kind: "PrometheusTimeSeriesQuery",
        spec: { query: "rate(errors{job=~\"$job\"}[5m])" },
      },
    );
    expect(panelPromQL(panel, { instance: "web-1", job: ["a", "b"] })).toEqual([
      'up{instance="web-1"}',
      'rate(errors{job=~"a|b"}[5m])',
    ]);
  });

  it("skips other query kinds and empty expressions", () => {
    const panel = panelWithQueries(
      { kind: "SomeOtherQuery", spec: { query: "up" } },
      { kind: "PrometheusTimeSeriesQuery", spec: { query: "" } },
      { kind: "PrometheusTimeSeriesQuery", spec: {} },
      { kind: "PrometheusTimeSeriesQuery", spec: { query: "up" } },
    );
    expect(panelPromQL(panel, {})).toEqual(["up"]);
  });

  it("returns nothing for a panel without queries", () => {
    expect(panelPromQL(panelWithQueries(), {})).toEqual([]);
    expect(
      panelPromQL(
        { kind: "Panel", spec: { plugin: { kind: "Markdown" } } } as Panel,
        {},
      ),
    ).toEqual([]);
  });
});
