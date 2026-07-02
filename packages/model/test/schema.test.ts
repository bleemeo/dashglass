import { describe, expect, it } from "vitest";

import {
  dashboardSchema,
  detectFormat,
  migrateDashboard,
  panelKeyFromRef,
  panelRefFromKey,
  parseDashboard,
} from "../src";
import { nodeOverviewDashboard } from "./fixtures";

describe("dashboard schema", () => {
  it("accepts the reference fixture", () => {
    expect(() => dashboardSchema.parse(nodeOverviewDashboard())).not.toThrow();
  });

  it("rejects a layout $ref to a missing panel", () => {
    const dashboard = nodeOverviewDashboard();
    dashboard.spec.layouts[0]!.spec.items[0]!.content.$ref =
      "#/spec/panels/missing";
    const result = dashboardSchema.safeParse(dashboard);
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toContain(
      'unknown panel "missing"',
    );
  });

  it("rejects duplicate variable names", () => {
    const dashboard = nodeOverviewDashboard();
    dashboard.spec.variables = [
      { kind: "TextVariable", spec: { name: "env", value: "prod" } },
      { kind: "TextVariable", spec: { name: "env", value: "staging" } },
    ];
    const result = dashboardSchema.safeParse(dashboard);
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toContain(
      'duplicate variable name "env"',
    );
  });

  it("rejects invalid durations", () => {
    const dashboard = nodeOverviewDashboard();
    dashboard.spec.duration = "one hour";
    expect(dashboardSchema.safeParse(dashboard).success).toBe(false);
  });

  it("rejects unknown keys (catches typos in hand-edited files)", () => {
    const content = `
apiVersion: v1
kind: Dashboard
metadata: { name: minimal }
spec:
  panels: {}
  layouts: []
  refreshInterva1: 30s
`;
    expect(() => parseDashboard(content, "yaml")).toThrow(/refreshInterva1/);
  });

  it("rejects metric names with spaces in metadata.name", () => {
    const dashboard = nodeOverviewDashboard();
    dashboard.metadata.name = "node overview";
    expect(dashboardSchema.safeParse(dashboard).success).toBe(false);
  });
});

describe("migrations", () => {
  it("injects apiVersion on documents that predate the field", () => {
    const legacy = `
kind: Dashboard
metadata: { name: legacy }
spec:
  panels: {}
  layouts: []
`;
    const dashboard = parseDashboard(legacy, "yaml");
    expect(dashboard.apiVersion).toBe("v1");
  });

  it("leaves non-object documents untouched", () => {
    expect(migrateDashboard(null)).toBe(null);
    expect(migrateDashboard([1, 2])).toEqual([1, 2]);
    expect(migrateDashboard("kind: x")).toBe("kind: x");
  });
});

describe("helpers", () => {
  it("detects format by extension", () => {
    expect(detectFormat("dashboards/node.yaml")).toBe("yaml");
    expect(detectFormat("dashboards/node.yml")).toBe("yaml");
    expect(detectFormat("node.JSON")).toBe("json");
    expect(detectFormat("node.toml")).toBe("toml");
    expect(detectFormat("node.txt")).toBeUndefined();
    expect(detectFormat("no-extension")).toBeUndefined();
  });

  it("converts between panel keys and $refs", () => {
    expect(panelRefFromKey("cpu")).toBe("#/spec/panels/cpu");
    expect(panelKeyFromRef("#/spec/panels/cpu")).toBe("cpu");
  });
});
