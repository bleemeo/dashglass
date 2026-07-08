import { z } from "zod";

import type { TimeSeries } from "@dashglass/runtime";

import type { EChartsCoreOption } from "../echarts-setup";
import { seriesColor, type ChartTheme } from "../theme";
import { calculationSchema } from "../stat/calculations";
import { calculate } from "../stat/calculations";
import { formatValue, type Unit, unitSchema } from "../units";

export const barSpecSchema = z.object({
  unit: unitSchema.optional(),
  /** How each series reduces to its bar value (default: last). */
  calculation: calculationSchema.optional(),
  /** Bar direction; horizontal reads best for top-N comparisons. */
  orientation: z.enum(["horizontal", "vertical"]).optional(),
  sort: z.enum(["desc", "asc", "none"]).optional(),
});

export type BarSpec = z.infer<typeof barSpecSchema>;

/**
 * One measure compared across series: every bar wears the same hue —
 * magnitude is carried by length, not color (identity hues are for series
 * that must be told apart across charts).
 */
export function buildBarOption(
  series: TimeSeries[],
  spec: BarSpec,
  theme: ChartTheme,
): EChartsCoreOption {
  const unit: Unit = spec.unit ?? "none";
  const horizontal = (spec.orientation ?? "horizontal") === "horizontal";
  const sort = spec.sort ?? "desc";

  const rows = series
    .map((oneSeries) => ({
      name: oneSeries.name,
      value: calculate(oneSeries.points, spec.calculation ?? "last"),
    }))
    .filter((row): row is { name: string; value: number } => row.value !== null);
  if (sort !== "none") {
    rows.sort((a, b) => (sort === "desc" ? b.value - a.value : a.value - b.value));
  }
  // ECharts lays category axes bottom-up on the y axis; reverse so the
  // first row reads at the top in horizontal mode.
  const ordered = horizontal ? [...rows].reverse() : rows;

  const categoryAxis = {
    type: "category" as const,
    data: ordered.map((row) => row.name),
    axisLine: { lineStyle: { color: theme.baseline } },
    axisTick: { show: false },
    axisLabel: {
      color: theme.ink.secondary,
      fontSize: 11,
      // Long series names: keep them readable, not truncated to nothing.
      width: horizontal ? 140 : undefined,
      overflow: "truncate" as const,
    },
  };
  const valueAxis = {
    type: "value" as const,
    axisLabel: {
      color: theme.ink.muted,
      fontSize: 11,
      formatter: (value: number) => formatValue(value, unit),
    },
    splitLine: { lineStyle: { color: theme.gridline, type: "dashed" as const } },
  };

  return {
    animation: false,
    backgroundColor: "transparent",
    grid: {
      left: 8,
      right: 16,
      top: 12,
      bottom: 8,
      containLabel: true,
    },
    xAxis: horizontal ? valueAxis : categoryAxis,
    yAxis: horizontal ? categoryAxis : valueAxis,
    tooltip: {
      trigger: "item",
      confine: true,
      backgroundColor: theme.tooltipBackground,
      borderColor: theme.border,
      textStyle: { color: theme.ink.primary, fontSize: 12 },
      valueFormatter: (value: unknown) =>
        formatValue(typeof value === "number" ? value : null, unit),
    },
    series: [
      {
        type: "bar",
        data: ordered.map((row) => row.value),
        color: seriesColor(theme, 0),
        barMaxWidth: 24,
        itemStyle: {
          // Rounded data end only (anchored baseline stays square).
          borderRadius: horizontal ? [0, 4, 4, 0] : [4, 4, 0, 0],
        },
        // The value at the bar end, so magnitude reads without the axis.
        label: {
          show: true,
          position: horizontal ? "right" : "top",
          color: theme.ink.secondary,
          fontSize: 11,
          formatter: (params: { value: unknown }) =>
            formatValue(typeof params.value === "number" ? params.value : null, unit),
        },
      },
    ],
  };
}
