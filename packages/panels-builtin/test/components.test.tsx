import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import type { PanelData, TimeSeries } from "@dashglass/runtime";

import { StatChart } from "../src/stat/StatChart";
import { StatusGrid } from "../src/status/StatusGrid";
import { STATUS_PRESETS } from "../src/status/options";
import { TablePanel, tableColumns } from "../src/table/TablePanel";

const readyData = (series: PanelData["series"]): PanelData => ({
  state: "ready",
  series,
  errors: [],
});

// Unmount between tests so the shared document doesn't accumulate
// matches (several panels render the same "No data" empty state).
afterEach(cleanup);

describe("StatChart", () => {
  it("renders the hero value with unit and sparkline", () => {
    render(
      <StatChart
        spec={{ unit: "bytes", sparkline: true }}
        data={readyData([
          {
            name: "mem",
            labels: {},
            points: [
              [0, 512],
              [1000, 2048],
            ],
          },
        ])}
        timeRange={{ start: new Date(0), end: new Date(1000) }}
      />,
    );
    // Value and unit render as separate spans (large number, small unit).
    const valueEl = document.querySelector(".dashglass-stat-value");
    expect(valueEl?.textContent).toContain("2");
    expect(valueEl?.textContent).toContain("KiB");
    expect(document.querySelector(".dashglass-stat-sparkline")).not.toBeNull();
  });

  it("shows the empty state without series", () => {
    render(
      <StatChart
        spec={{}}
        data={readyData([])}
        timeRange={{ start: new Date(0), end: new Date(1000) }}
      />,
    );
    expect(screen.getByText("No data")).toBeDefined();
  });
});

describe("StatusGrid", () => {
  const range = { start: new Date(0), end: new Date(1000) };

  it("renders one hexagon per series with a state summary", () => {
    render(
      <StatusGrid
        spec={{ valueMappings: STATUS_PRESETS.boolean }}
        data={readyData([
          { name: "a", labels: { instance: "web-1" }, points: [[0, 1]] },
          { name: "b", labels: { instance: "web-2" }, points: [[0, 1]] },
          { name: "c", labels: { instance: "web-3" }, points: [[0, 0]] },
        ])}
        timeRange={range}
      />,
    );
    // One tile per series.
    expect(document.querySelectorAll(".dashglass-status-grid polygon")).toHaveLength(3);
    // Summary: two up (good), one down (critical).
    const summary = document.querySelector(".dashglass-status-summary");
    expect(summary?.textContent).toContain("2");
    expect(summary?.textContent).toContain("1");
    // Tooltip carries the tile name and mapped label.
    const titles = [...document.querySelectorAll(".dashglass-status-grid title")].map(
      (t) => t.textContent,
    );
    expect(titles).toContain("web-1: Up");
    expect(titles).toContain("web-3: Down");
  });

  it("sorts worst-first and caps with an overflow note", () => {
    render(
      <StatusGrid
        spec={{ valueMappings: STATUS_PRESETS.boolean, maxTiles: 3 }}
        data={readyData([
          { name: "a", labels: { instance: "a" }, points: [[0, 1]] }, // up
          { name: "b", labels: { instance: "b" }, points: [[0, 0]] }, // down
          { name: "c", labels: { instance: "c" }, points: [[0, 1]] }, // up
          { name: "d", labels: { instance: "d" }, points: [[0, 0]] }, // down
        ])}
        timeRange={range}
      />,
    );
    // 4 series, capped at 3 tiles → one collapses into "+1 more".
    expect(document.querySelectorAll(".dashglass-status-grid polygon")).toHaveLength(3);
    const summary = document.querySelector(".dashglass-status-summary");
    expect(summary?.textContent).toContain("+1 more");
    // Worst-first: the two down (critical) tiles are drawn before any up.
    const titles = [...document.querySelectorAll(".dashglass-status-grid title")].map(
      (t) => t.textContent,
    );
    expect(titles[0]).toContain("Down");
    expect(titles[1]).toContain("Down");
  });

  it("shows the empty state without series", () => {
    render(<StatusGrid spec={{}} data={readyData([])} timeRange={range} />);
    expect(screen.getByText("No data")).toBeDefined();
  });
});

describe("TablePanel", () => {
  const series: TimeSeries[] = [
    {
      name: "a",
      labels: { __name__: "up", instance: "web-1", job: "node" },
      points: [[0, 1]],
    },
    {
      name: "b",
      labels: { __name__: "up", instance: "web-2", mountpoint: "/" },
      points: [[0, 0.5]],
    },
  ];

  it("derives sorted label columns, dropping __name__", () => {
    expect(tableColumns(series)).toEqual(["instance", "job", "mountpoint"]);
  });

  it("renders one row per series with the last value", () => {
    render(
      <TablePanel
        spec={{ unit: "percentunit" }}
        data={readyData(series)}
        timeRange={{ start: new Date(0), end: new Date(1000) }}
      />,
    );
    expect(screen.getByText("web-1")).toBeDefined();
    expect(screen.getByText("web-2")).toBeDefined();
    expect(screen.getByText("100%")).toBeDefined();
    expect(screen.getByText("50%")).toBeDefined();
  });
});
