import { describe, expect, it } from "vitest";

import {
  STATUS_PRESETS,
  honeycombColumns,
  layoutHoneycomb,
  lightChartTheme,
  mapStatus,
  orderBySeverity,
  statusColor,
  summarize,
  type StatusItem,
} from "../src";

describe("mapStatus", () => {
  // Nagios / Glouton _status codes over Prometheus: 0=OK, 1=Warning,
  // 2=Critical, 3=Unknown.
  const nagios = STATUS_PRESETS.nagios!;

  it("maps values through the status-code preset", () => {
    expect(mapStatus(0, nagios)).toEqual({ status: "good", text: "OK" });
    expect(mapStatus(1, nagios)).toEqual({ status: "warning", text: "Warning" });
    expect(mapStatus(2, nagios)).toEqual({ status: "critical", text: "Critical" });
    expect(mapStatus(3, nagios)).toEqual({ status: "unknown", text: "Unknown" });
  });

  it("falls back for unmapped values and nulls", () => {
    expect(mapStatus(9, nagios)).toEqual({ status: "unknown", text: "9" });
    expect(mapStatus(9, nagios, "critical").status).toBe("critical");
    expect(mapStatus(null, nagios)).toEqual({ status: "unknown", text: "—" });
  });

  it("boolean preset covers up/down", () => {
    const bool = STATUS_PRESETS.boolean!;
    expect(mapStatus(1, bool)).toEqual({ status: "good", text: "Up" });
    expect(mapStatus(0, bool)).toEqual({ status: "critical", text: "Down" });
  });
});

describe("statusColor", () => {
  it("uses the reserved ramp, and neutral ink for unknown", () => {
    expect(statusColor(lightChartTheme, "critical")).toBe(
      lightChartTheme.status.critical,
    );
    expect(statusColor(lightChartTheme, "unknown")).toBe(
      lightChartTheme.ink.muted,
    );
  });
});

describe("summarize", () => {
  it("counts by state in severity order, dropping empties", () => {
    const items: StatusItem[] = [
      { name: "a", status: "good", text: "OK" },
      { name: "b", status: "good", text: "OK" },
      { name: "c", status: "critical", text: "Critical" },
    ];
    expect(summarize(items)).toEqual([
      { status: "good", count: 2 },
      { status: "critical", count: 1 },
    ]);
  });
});

describe("orderBySeverity", () => {
  it("puts problems first, stable within a state", () => {
    const items: StatusItem[] = [
      { name: "a", status: "good", text: "OK" },
      { name: "b", status: "critical", text: "Critical" },
      { name: "c", status: "good", text: "OK" },
      { name: "d", status: "warning", text: "Warning" },
      { name: "e", status: "critical", text: "Critical" },
    ];
    // critical (b,e keep order) → warning (d) → good (a,c keep order).
    expect(orderBySeverity(items).map((i) => i.name)).toEqual([
      "b",
      "e",
      "d",
      "a",
      "c",
    ]);
  });

  it("does not mutate the input", () => {
    const items: StatusItem[] = [
      { name: "a", status: "good", text: "OK" },
      { name: "b", status: "critical", text: "Critical" },
    ];
    orderBySeverity(items);
    expect(items[0]!.name).toBe("a");
  });
});

describe("honeycomb layout", () => {
  it("derives a pleasant, slightly-wide column count", () => {
    expect(honeycombColumns(1)).toBe(1);
    expect(honeycombColumns(24)).toBe(8);
  });

  it("places one center per item, tiles drawn inside their cell", () => {
    const layout = layoutHoneycomb(24);
    expect(layout.positions).toHaveLength(24);
    expect(layout.radius).toBeLessThan(10); // gap vs the 10-unit cell
    // Second row is shifted right (offset honeycomb).
    const firstRow = layout.positions[0]!;
    const secondRow = layout.positions[8]!;
    expect(secondRow.cy).toBeGreaterThan(firstRow.cy);
    expect(secondRow.cx).toBeGreaterThan(firstRow.cx);
  });

  it("respects an explicit column count", () => {
    const layout = layoutHoneycomb(6, 3);
    // Row 0: items 0..2 share cy; item 3 starts row 1.
    expect(layout.positions[0]!.cy).toBe(layout.positions[2]!.cy);
    expect(layout.positions[3]!.cy).toBeGreaterThan(layout.positions[0]!.cy);
  });
});
