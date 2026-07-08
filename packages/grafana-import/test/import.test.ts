import { describe, expect, it } from "vitest";

import { dashboardSchema, stringifyDashboard } from "@dashglass/model";

import {
  importGrafanaDashboard,
  parseLabelValues,
  rewriteExpression,
} from "../src";
import fixture from "./fixtures/node-dashboard.json";

describe("importGrafanaDashboard", () => {
  const { dashboard, warnings } = importGrafanaDashboard(fixture);

  it("produces a schema-valid, serializable dashboard", () => {
    expect(() => dashboardSchema.parse(dashboard)).not.toThrow();
    expect(() => stringifyDashboard(dashboard, "yaml")).not.toThrow();
  });

  it("maps metadata, time range and refresh", () => {
    expect(dashboard.metadata.name).toBe("node-exporter-overview");
    expect(dashboard.spec.display?.name).toBe("Node Exporter — Overview");
    expect(dashboard.spec.duration).toBe("6h");
    expect(dashboard.spec.refreshInterval).toBe("30s");
  });

  it("splits rows into sections and normalizes y offsets", () => {
    expect(dashboard.spec.layouts).toHaveLength(3);
    expect(dashboard.spec.layouts[0]!.spec.display).toBeUndefined();
    expect(dashboard.spec.layouts[1]!.spec.display?.title).toBe("Memory");
    expect(dashboard.spec.layouts[2]!.spec.display?.title).toBe("Details");
    // Section 2 panels start at Grafana y=9 → normalized to 0.
    expect(
      dashboard.spec.layouts[1]!.spec.items.every((item) => item.y === 0),
    ).toBe(true);
    // Collapsed row children are imported like flat ones.
    expect(dashboard.spec.layouts[2]!.spec.items).toHaveLength(2);
  });

  it("maps panel kinds, including legacy types", () => {
    const kinds = Object.fromEntries(
      Object.entries(dashboard.spec.panels).map(([key, panel]) => [
        key,
        panel.spec.plugin.kind,
      ]),
    );
    expect(kinds).toEqual({
      about: "Markdown",
      "cpu-usage": "TimeSeriesChart",
      load: "GaugeChart",
      "memory-available": "StatChart",
      uptime: "StatChart",
      "filesystem-breakdown": "grafana/piechart",
      "network-traffic": "TimeSeriesChart",
      "disk-usage-by-mount": "BarChart",
    });
  });

  it("migrates specs field by field", () => {
    const cpu = dashboard.spec.panels["cpu-usage"]!.spec.plugin.spec!;
    expect(cpu).toEqual({
      unit: "percentunit",
      max: 1,
      stack: true,
      area: true,
      legend: { position: "right" },
    });

    const load = dashboard.spec.panels["load"]!.spec.plugin.spec!;
    expect(load["thresholds"]).toEqual([
      { value: 8, status: "warning" },
      { value: 12, status: "critical" },
    ]);

    const uptime = dashboard.spec.panels["uptime"]!.spec.plugin.spec!;
    expect(uptime).toEqual({ unit: "seconds", sparkline: true });

    const network =
      dashboard.spec.panels["network-traffic"]!.spec.plugin.spec!;
    expect(network).toEqual({
      unit: "bytesps",
      stack: true,
      area: true,
      legend: { position: "hidden" },
    });

    const markdown = dashboard.spec.panels["about"]!.spec.plugin.spec!;
    expect(markdown["content"]).toContain("# Node overview");
  });

  it("converts queries: templating rewrite, hidden targets dropped", () => {
    const queries = dashboard.spec.panels["cpu-usage"]!.spec.queries!;
    expect(queries).toHaveLength(1);
    const spec = queries[0]!.spec.plugin.spec!;
    expect(spec["query"]).toBe(
      'sum by (mode) (rate(node_cpu_seconds_total{instance=~"$instance",job="${job}"}[5m]))',
    );
    expect(spec["seriesNameFormat"]).toBe("{{mode}}");
  });

  it("converts variables and skips the unconvertible with warnings", () => {
    const variables = dashboard.spec.variables!;
    expect(variables.map((variable) => variable.spec.name)).toEqual([
      "instance",
      "job",
      "cluster",
      "filter",
    ]);

    const instance = variables[0]!;
    expect(instance.kind).toBe("ListVariable");
    expect(instance.spec).toMatchObject({
      allowAllValue: true,
      allowMultiple: true,
      display: { name: "Instance" },
      plugin: {
        kind: "PrometheusLabelValuesVariable",
        spec: {
          labelName: "instance",
          matchers: ['node_uname_info{job="node"}'],
        },
      },
    });

    expect(warnings.some((warning) => warning.includes('"weird"'))).toBe(true);
    expect(warnings.some((warning) => warning.includes('"percentile"'))).toBe(
      true,
    );
    expect(
      warnings.some((warning) => warning.includes('type "piechart"')),
    ).toBe(true);
  });

  it("rejects non-Grafana input with a clear error", () => {
    expect(() => importGrafanaDashboard(null)).toThrow(/JSON object/);
    expect(() => importGrafanaDashboard({ title: "x" })).toThrow(
      /missing panels/,
    );
    expect(() =>
      importGrafanaDashboard({ rows: [{}], schemaVersion: 14 }),
    ).toThrow(/pre-Grafana-5/);
  });
});

describe("rewriteExpression", () => {
  it("normalizes every templating form", () => {
    expect(rewriteExpression("up{a=~\"[[instance]]\"}")).toBe(
      'up{a=~"$instance"}',
    );
    expect(rewriteExpression("rate(x[$__rate_interval])")).toBe(
      "rate(x[5m])",
    );
    expect(rewriteExpression("rate(x[${__interval}])")).toBe("rate(x[5m])");
    expect(rewriteExpression("x{j=\"${job:pipe}\"}")).toBe('x{j="${job}"}');
  });
});

describe("unit mapping", () => {
  it("maps rate and network units to the generic Dashglass units", () => {
    const converted = importGrafanaDashboard({
      title: "Units",
      panels: [
        {
          type: "timeseries",
          title: "net",
          gridPos: { x: 0, y: 0, w: 12, h: 8 },
          fieldConfig: { defaults: { unit: "bps" } },
        },
        {
          type: "timeseries",
          title: "packets",
          gridPos: { x: 12, y: 0, w: 12, h: 8 },
          fieldConfig: { defaults: { unit: "pps" } },
        },
      ],
    });
    expect(converted.dashboard.spec.panels["net"]!.spec.plugin.spec).toEqual({
      unit: "bitsps",
    });
    expect(
      converted.dashboard.spec.panels["packets"]!.spec.plugin.spec,
    ).toEqual({ unit: "ops" });
    expect(converted.warnings).toHaveLength(0);
  });
});

describe("parseLabelValues", () => {
  it("parses both arities and metric selectors with commas", () => {
    expect(parseLabelValues("label_values(instance)")).toEqual({
      labelName: "instance",
    });
    expect(
      parseLabelValues('label_values(up{job="a",env="b"}, instance)'),
    ).toEqual({ labelName: "instance", matcher: 'up{job="a",env="b"}' });
    expect(parseLabelValues("topk(5, up)")).toBeNull();
  });
});
