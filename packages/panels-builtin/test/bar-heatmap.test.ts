import { describe, expect, it } from "vitest";

import type { TimeSeries } from "@dashglass/runtime";

import { buildBarOption } from "../src/bar/options";
import { buildHeatmapOption, toHeatmapBuckets } from "../src/heatmap/options";
import { lightChartTheme } from "../src/theme";

function series(
  name: string,
  labels: Record<string, string>,
  points: [number, number | null][],
): TimeSeries {
  return { name, labels, points };
}

const T0 = 1_700_000_000_000;
const T1 = T0 + 60_000;

describe("buildBarOption", () => {
  const input = [
    series("a", {}, [
      [T0, 1],
      [T1, 3],
    ]),
    series("b", {}, [
      [T0, 10],
      [T1, 8],
    ]),
    series("empty", {}, [[T0, null]]),
  ];

  it("reduces each series with the calculation and sorts descending", () => {
    const option = buildBarOption(input, {}, lightChartTheme) as {
      series: { data: number[] }[];
      yAxis: { data: string[] };
    };
    // Horizontal default: rows reversed so the biggest reads at the top.
    expect(option.yAxis.data).toEqual(["a", "b"]);
    expect(option.series[0]!.data).toEqual([3, 8]);
  });

  it("respects calculation, orientation and sort", () => {
    const option = buildBarOption(
      input,
      { calculation: "sum", orientation: "vertical", sort: "asc" },
      lightChartTheme,
    ) as { series: { data: number[] }[]; xAxis: { data: string[] } };
    expect(option.xAxis.data).toEqual(["a", "b"]);
    expect(option.series[0]!.data).toEqual([4, 18]);
  });

  it("colors every bar with the same first-slot hue", () => {
    const option = buildBarOption(input, {}, lightChartTheme) as {
      series: { color: string }[];
    };
    expect(option.series[0]!.color).toBe(lightChartTheme.series[0]);
  });
});

describe("toHeatmapBuckets", () => {
  const buckets = [
    series("le=0.1", { le: "0.1" }, [
      [T0, 5],
      [T1, 6],
    ]),
    series("le=+Inf", { le: "+Inf" }, [
      [T0, 8],
      [T1, 7],
    ]),
  ];

  it("de-cumulates counts per band and sorts by boundary", () => {
    const result = toHeatmapBuckets(buckets, "seconds")!;
    expect(result.buckets.map((bucket) => bucket.label)).toEqual([
      "≤ 100 ms",
      "+Inf",
    ]);
    expect(result.buckets[0]!.points.get(T0)).toBe(5);
    expect(result.buckets[1]!.points.get(T0)).toBe(3);
    // Non-monotonic input (7 < 6 would give -? no: 7-6=1) still clamps ≥ 0.
    expect(result.buckets[1]!.points.get(T1)).toBe(1);
  });

  it("returns null without le-labelled series", () => {
    expect(toHeatmapBuckets([series("x", {}, [[T0, 1]])], "none")).toBeNull();
  });

  it("builds an option on the sequential ramp", () => {
    const option = buildHeatmapOption(buckets, {}, lightChartTheme) as {
      visualMap: { inRange: { color: string[] } };
      series: { data: [number, number, number][] }[];
    } | null;
    expect(option).not.toBeNull();
    expect(option!.visualMap.inRange.color).toEqual(lightChartTheme.sequential);
    expect(option!.series[0]!.data).toContainEqual([0, 1, 3]);
  });
});
