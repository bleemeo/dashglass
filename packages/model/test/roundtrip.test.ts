import { describe, expect, it } from "vitest";

import {
  DASHBOARD_FORMATS,
  parseDashboard,
  stringifyDashboard,
} from "../src";
import { nodeOverviewDashboard } from "./fixtures";

describe.each(DASHBOARD_FORMATS)("%s round-trip", (format) => {
  it("stringify then parse returns an equivalent dashboard", () => {
    const dashboard = nodeOverviewDashboard();
    const encoded = stringifyDashboard(dashboard, format);
    expect(parseDashboard(encoded, format)).toEqual(dashboard);
  });

  it("output is deterministic", () => {
    const first = stringifyDashboard(nodeOverviewDashboard(), format);
    const second = stringifyDashboard(nodeOverviewDashboard(), format);
    expect(second).toBe(first);
  });

  it("re-encoding a parsed document is byte-identical (stable canonical form)", () => {
    const encoded = stringifyDashboard(nodeOverviewDashboard(), format);
    const reEncoded = stringifyDashboard(parseDashboard(encoded, format), format);
    expect(reEncoded).toBe(encoded);
  });
});

describe("canonical key order", () => {
  it("does not depend on input key order", () => {
    // Same dashboard, hand-written with keys in a scrambled order.
    const scrambled = `
kind: Dashboard
spec:
  layouts:
    - spec:
        items:
          - content: { $ref: "#/spec/panels/cpu" }
            height: 8
            width: 12
            y: 0
            x: 0
      kind: Grid
  panels:
    cpu:
      spec:
        queries:
          - spec:
              plugin:
                spec: { query: "up" }
                kind: PrometheusTimeSeriesQuery
            kind: TimeSeriesQuery
        plugin: { kind: TimeSeriesChart }
      kind: Panel
  duration: 1h
apiVersion: v1
metadata: { name: minimal }
`;
    const ordered = `
apiVersion: v1
kind: Dashboard
metadata: { name: minimal }
spec:
  panels:
    cpu:
      kind: Panel
      spec:
        plugin: { kind: TimeSeriesChart }
        queries:
          - kind: TimeSeriesQuery
            spec:
              plugin:
                kind: PrometheusTimeSeriesQuery
                spec: { query: "up" }
  layouts:
    - kind: Grid
      spec:
        items:
          - x: 0
            y: 0
            width: 12
            height: 8
            content: { $ref: "#/spec/panels/cpu" }
  duration: 1h
`;
    const fromScrambled = stringifyDashboard(
      parseDashboard(scrambled, "yaml"),
      "yaml",
    );
    const fromOrdered = stringifyDashboard(
      parseDashboard(ordered, "yaml"),
      "yaml",
    );
    expect(fromScrambled).toBe(fromOrdered);
  });

  it("a one-field edit produces a one-line YAML diff", () => {
    const before = stringifyDashboard(nodeOverviewDashboard(), "yaml").split("\n");

    const edited = nodeOverviewDashboard();
    edited.spec.panels["cpu"]!.spec.display = { name: "CPU (all cores)" };
    const after = stringifyDashboard(edited, "yaml").split("\n");

    expect(after.length).toBe(before.length);
    const changed = before.filter((line, index) => line !== after[index]);
    expect(changed).toHaveLength(1);
    expect(changed[0]).toContain("CPU usage");
  });

  it("a one-field edit to a data link produces a one-line YAML diff", () => {
    const before = stringifyDashboard(nodeOverviewDashboard(), "yaml").split("\n");

    const edited = nodeOverviewDashboard();
    edited.spec.panels["memory"]!.spec.links![0]!.title = "Host detail";
    const after = stringifyDashboard(edited, "yaml").split("\n");

    expect(after.length).toBe(before.length);
    const changed = before.filter((line, index) => line !== after[index]);
    expect(changed).toHaveLength(1);
    expect(changed[0]).toContain("Node detail");
  });

  it("keeps long PromQL expressions on a single YAML line", () => {
    const edited = nodeOverviewDashboard();
    const longQuery = `sum by (instance, mode) (rate(node_cpu_seconds_total{instance=~"$instance",mode!="idle",job="node-exporter-with-a-long-name"}[5m]))`;
    edited.spec.panels["cpu"]!.spec.queries![0]!.spec.plugin.spec = {
      query: longQuery,
    };

    const lines = stringifyDashboard(edited, "yaml").split("\n");
    expect(lines.some((line) => line.includes(longQuery))).toBe(true);
  });
});
