import { z } from "zod";

import type { TimeSeries } from "@polarisui/runtime";

import type { EChartsCoreOption } from "../echarts-setup";
import { seriesColor, type ChartTheme } from "../theme";
import { formatValue, type Unit, unitSchema } from "../units";

export const timeSeriesSpecSchema = z.object({
  legend: z
    .object({
      position: z.enum(["bottom", "right", "hidden"]).optional(),
    })
    .optional(),
  /** Stacked series (implies filled areas). */
  stack: z.boolean().optional(),
  /** Filled area under each line. */
  area: z.boolean().optional(),
  unit: unitSchema.optional(),
  min: z.number().optional(),
  max: z.number().optional(),
});

export type TimeSeriesSpec = z.infer<typeof timeSeriesSpecSchema>;

const PALETTE_SIZE = 8;

/** "#rrggbb" → "rgba(r,g,b,alpha)". */
function withAlpha(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

export function buildTimeSeriesOption(
  series: TimeSeries[],
  spec: TimeSeriesSpec,
  theme: ChartTheme,
): EChartsCoreOption {
  const unit: Unit = spec.unit ?? "none";
  const legendPosition = spec.legend?.position ?? "bottom";
  const showLegend = series.length > 1 && legendPosition !== "hidden";
  const filled = spec.stack || spec.area;

  return {
    animation: false,
    backgroundColor: "transparent",
    // Invisible-but-instantiated toolbox (show:false would skip creating
    // the feature): registers drag-to-select zoom, which <EChart> keeps
    // active so brushing a span lets the host zoom the time range.
    toolbox: {
      show: true,
      itemSize: 0,
      feature: {
        dataZoom: {
          yAxisIndex: "none",
          icon: { zoom: "path://", back: "path://" },
          // Highlighter-style selection instead of the default gray block.
          brushStyle: {
            color: withAlpha(seriesColor(theme, 0), 0.12),
            borderColor: withAlpha(seriesColor(theme, 0), 0.6),
            borderWidth: 1,
          },
        },
      },
    },
    grid: {
      left: 8,
      right: legendPosition === "right" && showLegend ? 120 : 16,
      top: 12,
      // Leave room for the bottom legend below the time axis labels.
      bottom: legendPosition === "bottom" && showLegend ? 28 : 8,
      containLabel: true,
    },
    xAxis: {
      type: "time",
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: { color: theme.ink.muted, fontSize: 11 },
    },
    yAxis: {
      type: "value",
      min: spec.min,
      max: spec.max,
      axisLabel: {
        color: theme.ink.muted,
        fontSize: 11,
        formatter: (value: number) => formatValue(value, unit),
      },
      splitLine: {
        lineStyle: { color: theme.gridline, type: "dashed" },
      },
    },
    tooltip: {
      trigger: "axis",
      confine: true,
      axisPointer: {
        type: "line",
        lineStyle: { color: theme.baseline },
      },
      backgroundColor: theme.tooltipBackground,
      borderColor: theme.border,
      textStyle: { color: theme.ink.primary, fontSize: 12 },
      valueFormatter: (value: unknown) =>
        formatValue(typeof value === "number" ? value : null, unit),
    },
    legend: {
      show: showLegend,
      type: "scroll",
      icon: "circle",
      ...(legendPosition === "right"
        ? { orient: "vertical", right: 0, top: "middle" }
        : { bottom: 0 }),
      textStyle: { color: theme.ink.secondary, fontSize: 11 },
    },
    series: series.map((oneSeries, index) => ({
      type: "line",
      name: oneSeries.name,
      data: oneSeries.points,
      showSymbol: false,
      connectNulls: false,
      color: seriesColor(theme, index),
      lineStyle: {
        width: 2,
        // Past the palette, colors repeat: dashing is the secondary
        // encoding that keeps repeated hues distinguishable.
        type: index >= PALETTE_SIZE ? ("dashed" as const) : ("solid" as const),
      },
      ...(spec.stack ? { stack: "total" } : {}),
      ...(filled ? { areaStyle: { opacity: spec.stack ? 0.35 : 0.12 } } : {}),
      emphasis: { focus: "series" as const },
    })),
  };
}
