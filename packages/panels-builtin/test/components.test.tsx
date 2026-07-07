import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { PanelData, TimeSeries } from "@polarisui/runtime";

import { StatChart } from "../src/stat/StatChart";
import { TablePanel, tableColumns } from "../src/table/TablePanel";

const readyData = (series: PanelData["series"]): PanelData => ({
  state: "ready",
  series,
  errors: [],
});

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
    const valueEl = document.querySelector(".polaris-stat-value");
    expect(valueEl?.textContent).toContain("2");
    expect(valueEl?.textContent).toContain("KiB");
    expect(document.querySelector(".polaris-stat-sparkline")).not.toBeNull();
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
