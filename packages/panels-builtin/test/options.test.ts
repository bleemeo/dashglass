import { describe, expect, it } from "vitest";

import type { TimeSeries } from "@dashglass/runtime";

import {
  buildGaugeOption,
  buildTimeSeriesOption,
  buildTooltipHTML,
  calculate,
  gaugeStatus,
  gaugeTrackStops,
  lightChartTheme,
  sortTableRows,
  statValueColor,
  tableValueColor,
  withAlpha,
  type TooltipParam,
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

  it("clamps out-of-range values so the arc never over-fills", () => {
    const over = buildGaugeOption(3_000_000_000, {}, lightChartTheme) as {
      series: { data: { value: number }[] }[];
    };
    expect(over.series[0]?.data[0]?.value).toBe(100);
    const under = buildGaugeOption(-5, {}, lightChartTheme) as {
      series: { data: { value: number }[] }[];
    };
    expect(under.series[0]?.data[0]?.value).toBe(0);
  });

  it("marks threshold zones on the background track", () => {
    const stops = gaugeTrackStops(spec, lightChartTheme)!;
    // Zones: good up to 70%, warning up to 90%, critical to the end —
    // tinted so the full-strength progress arc stays readable on top.
    expect(stops.map(([at]) => at)).toEqual([0.7, 0.9, 1]);
    // Tinted status colors, in zone order: good, warning, critical.
    expect(stops.map(([, color]) => color)).toEqual([
      withAlpha(lightChartTheme.status.good, 0.4),
      withAlpha(lightChartTheme.status.warning, 0.4),
      withAlpha(lightChartTheme.status.critical, 0.4),
    ]);
    // No thresholds → no zones (plain gridline track).
    expect(gaugeTrackStops({}, lightChartTheme)).toBeNull();
  });

  it("clamps threshold zones into the min/max span", () => {
    const stops = gaugeTrackStops(
      { min: 0, max: 80, thresholds: [{ value: 100, status: "critical" }] },
      lightChartTheme,
    )!;
    expect(stops.map(([at]) => at)).toEqual([1, 1]);
  });
});

describe("buildTooltipHTML", () => {
  // Real ECharts markers are name-free colored spans.
  const param = (
    name: string,
    value: number | null,
    label = "14:00",
  ): TooltipParam => ({
    seriesName: name,
    marker: `<span class="dot"></span>`,
    value: [0, value],
    axisValueLabel: label,
  });

  it("sorts entries by value, descending", () => {
    const html = buildTooltipHTML(
      [param("aaa", 1), param("bbb", 9), param("ccc", 5)],
      "none",
      lightChartTheme,
    );
    const order = ["bbb", "ccc", "aaa"].map((name) =>
      html.indexOf(`${name}</span>`),
    );
    expect(order[0]).toBeLessThan(order[1]!);
    expect(order[1]).toBeLessThan(order[2]!);
  });

  it("caps rows and reports how many series are hidden", () => {
    const params = Array.from({ length: 25 }, (_, index) =>
      param(`series-${index}`, index),
    );
    const html = buildTooltipHTML(params, "none", lightChartTheme);
    expect(html.match(/class="dot"/g)?.length).toBe(10);
    expect(html).toContain("… 15 more series");
    // Top values survive the cut, bottom ones don't.
    expect(html).toContain("series-24</span>");
    expect(html).not.toContain("series-3</span>");
  });

  it("skips null points and formats with the panel unit", () => {
    const html = buildTooltipHTML(
      [param("gone", null), param("mem", 3 * 1024 ** 3)],
      "bytes",
      lightChartTheme,
    );
    expect(html).not.toContain("gone");
    expect(html).toContain("3 GiB");
    expect(html).toContain("14:00");
  });

  it("escapes HTML in series names", () => {
    const html = buildTooltipHTML(
      [param('up{label="<b>"}', 1)],
      "none",
      lightChartTheme,
    );
    expect(html).toContain("&lt;b&gt;");
    expect(html).not.toContain('label="<b>"');
  });
});

describe("sortTableRows", () => {
  const rows = [
    { labels: { instance: "host-b" }, value: 2 },
    { labels: { instance: "host-a" }, value: null },
    { labels: { instance: "host-c" }, value: 9 },
  ];

  it("sorts by a label column in both directions", () => {
    expect(
      sortTableRows(rows, "instance", 1).map((r) => r.labels["instance"]),
    ).toEqual(["host-a", "host-b", "host-c"]);
    expect(
      sortTableRows(rows, "instance", -1).map((r) => r.labels["instance"]),
    ).toEqual(["host-c", "host-b", "host-a"]);
  });

  it("sorts by value with nulls as smallest", () => {
    expect(sortTableRows(rows, null, 1).map((r) => r.value)).toEqual([
      null,
      2,
      9,
    ]);
    expect(sortTableRows(rows, null, -1).map((r) => r.value)).toEqual([
      9,
      2,
      null,
    ]);
  });

  it("does not mutate the input", () => {
    sortTableRows(rows, null, -1);
    expect(rows[0]?.labels["instance"]).toBe("host-b");
  });
});

describe("statValueColor", () => {
  const thresholds = [
    { value: 70, status: "warning" as const },
    { value: 90, status: "critical" as const },
  ];

  it("stays neutral without thresholds or without a value", () => {
    expect(statValueColor(95, {}, lightChartTheme)).toBe(
      lightChartTheme.ink.primary,
    );
    expect(statValueColor(null, { thresholds }, lightChartTheme)).toBe(
      lightChartTheme.ink.primary,
    );
  });

  it("uses the status ramp when thresholds are set", () => {
    expect(statValueColor(50, { thresholds }, lightChartTheme)).toBe(
      lightChartTheme.status.good,
    );
    expect(statValueColor(75, { thresholds }, lightChartTheme)).toBe(
      lightChartTheme.status.warning,
    );
    expect(statValueColor(95, { thresholds }, lightChartTheme)).toBe(
      lightChartTheme.status.critical,
    );
  });
});

describe("tableValueColor", () => {
  const thresholds = [
    { value: 70, status: "warning" as const },
    { value: 90, status: "critical" as const },
  ];

  it("stays neutral without thresholds or without a value", () => {
    expect(tableValueColor(95, {}, lightChartTheme)).toBe(
      lightChartTheme.ink.primary,
    );
    expect(tableValueColor(null, { thresholds }, lightChartTheme)).toBe(
      lightChartTheme.ink.primary,
    );
  });

  it("uses the status ramp when thresholds are set", () => {
    expect(tableValueColor(50, { thresholds }, lightChartTheme)).toBe(
      lightChartTheme.status.good,
    );
    expect(tableValueColor(95, { thresholds }, lightChartTheme)).toBe(
      lightChartTheme.status.critical,
    );
  });
});
