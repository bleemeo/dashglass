import { describe, expect, it } from "vitest";

import type { DashboardInfo } from "../api/client";
import { filterDashboards } from "./dashboardFilter";

const dashboards: DashboardInfo[] = [
  { name: "node-overview", format: "yaml", displayName: "Node overview" },
  {
    name: "infra/db",
    format: "yaml",
    displayName: "PostgreSQL",
    description: "Primary database cluster",
  },
  { name: "edge", format: "json" },
];

describe("filterDashboards", () => {
  it("returns everything for an empty or blank query", () => {
    expect(filterDashboards(dashboards, "")).toHaveLength(3);
    expect(filterDashboards(dashboards, "   ")).toHaveLength(3);
  });

  it("matches the file name, case-insensitively", () => {
    expect(filterDashboards(dashboards, "NODE").map((d) => d.name)).toEqual([
      "node-overview",
    ]);
  });

  it("matches the folder part of the name", () => {
    expect(filterDashboards(dashboards, "infra/").map((d) => d.name)).toEqual([
      "infra/db",
    ]);
  });

  it("matches display name and description", () => {
    expect(filterDashboards(dashboards, "postgres")).toHaveLength(1);
    expect(filterDashboards(dashboards, "database cluster")).toHaveLength(1);
  });

  it("handles dashboards without optional fields", () => {
    expect(filterDashboards(dashboards, "edge")).toHaveLength(1);
    expect(filterDashboards(dashboards, "nothing-matches")).toHaveLength(0);
  });
});
