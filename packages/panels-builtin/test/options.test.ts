import { describe, expect, it } from "vitest";

import type { TimeSeries } from "@polarisui/runtime";

import {
  buildGaugeOption,
  buildTimeSeriesOption,
  calculate,
  gaugeStatus,
  lightChartTheme,
} from "../src";

function series(name: string, values: (number | null)[]): TimeSeries {
  return {
    name,
    labels: {},
    points: values.map((value, index) => [index * 1000, value]),
  };
}

describe("buildTimeSeriesOption", () => {
  it("assigns categorical colors in fixed slot order", () => {
    const option = buildTimeSeriesOption(
      [series("a", [1]), series("b", [2]), series("c", [3])],
      {},
      lightChartTheme,
    ) as { series: { color: string; lineStyle: { type: string } }[] };
    expect(option.series.map((s) => s.color)).toEqual(
      lightChartTheme.series.slice(0, 3),
    );
    expect(option.series.every((s) => s.lineStyle.type === "solid")).toBe(true);
  });

  it("dashes repeated hues past the palette size", () => {
    const many = Array.from({ length: 10 }, (_, i) => series(`s${i}`, [i]));
    const option = buildTimeSeriesOption(many, {}, lightChartTheme) as {
      series: { color: string; lineStyle: { type: string } }[];
    };
    expect(option.series[8]?.color).toBe(lightChartTheme.series[0]);
    expect(option.series[8]?.lineStyle.type).toBe("dashed");
  });

  it("hides the legend for a single series", () => {
    const single = buildTimeSeriesOption([series("a", [1])], {}, lightChartTheme) as {
      legend: { show: boolean };
    };
    expect(single.legend.show).toBe(false);
    const two = buildTimeSeriesOption(
      [series("a", [1]), series("b", [2])],
      {},
      lightChartTheme,
    ) as { legend: { show: boolean } };
    expect(two.legend.show).toBe(true);
  });

  it("stacks with filled areas when requested", () => {
    const option = buildTimeSeriesOption(
      [series("a", [1]), series("b", [2])],
      { stack: true },
      lightChartTheme,
    ) as { series: { stack?: string; areaStyle?: object }[] };
    expect(option.series[0]?.stack).toBe("total");
    expect(option.series[0]?.areaStyle).toBeDefined();
  });
});

describe("calculate", () => {
  const points: [number, number | null][] = [
    [0, 4],
    [1, null],
    [2, 2],
  ];
  it("reduces ignoring null gaps", () => {
    expect(calculate(points, "last")).toBe(2);
    expect(calculate(points, "mean")).toBe(3);
    expect(calculate(points, "min")).toBe(2);
    expect(calculate(points, "max")).toBe(4);
    expect(calculate(points, "sum")).toBe(6);
  });
  it("returns null when every point is a gap", () => {
    expect(calculate([[0, null]], "last")).toBeNull();
  });
});

describe("gauge", () => {
  const spec = {
    thresholds: [
      { value: 70, status: "warning" as const },
      { value: 90, status: "critical" as const },
    ],
  };

  it("matches the highest crossed threshold", () => {
    expect(gaugeStatus(50, spec)).toBe("good");
    expect(gaugeStatus(75, spec)).toBe("warning");
    expect(gaugeStatus(95, spec)).toBe("critical");
  });

  it("colors the progress arc with the reserved status color", () => {
    const option = buildGaugeOption(95, spec, lightChartTheme) as {
      series: { progress: { itemStyle: { color: string } } }[];
    };
    expect(option.series[0]?.progress.itemStyle.color).toBe(
      lightChartTheme.status.critical,
    );
  });

  it("uses the first categorical slot without thresholds", () => {
    const option = buildGaugeOption(50, {}, lightChartTheme) as {
      series: { progress: { itemStyle: { color: string } } }[];
    };
    expect(option.series[0]?.progress.itemStyle.color).toBe(
      lightChartTheme.series[0],
    );
  });
});
