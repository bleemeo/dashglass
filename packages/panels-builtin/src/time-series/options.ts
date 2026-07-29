import { z } from "zod";

import type { TimeSeries } from "@dashglass/runtime";

import type { EChartsCoreOption } from "../echarts-setup";
import { seriesColor, withAlpha, type ChartTheme } from "../theme";
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

/** Tooltip row cap: past this, a "… N more series" line says what's cut. */
const TOOLTIP_MAX_SERIES = 10;

function escapeHTML(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/** The subset of ECharts' axis-trigger callback params the tooltip uses. */
export interface TooltipParam {
  seriesName?: string;
  /** ECharts-provided colored dot (HTML). */
  marker?: string;
  /** Our data points are [timestamp, value] pairs. */
  value?: unknown;
  axisValueLabel?: string;
}

/**
 * Axis tooltip body: entries sorted by value (descending — "who is on
 * top?"), capped at TOOLTIP_MAX_SERIES so a 50-series panel stays
 * readable, values formatted with the panel unit. Exported for tests.
 */
export function buildTooltipHTML(
  params: TooltipParam[],
  unit: Unit,
  theme: ChartTheme,
): string {
  const entries = params.flatMap((param) => {
    const value = Array.isArray(param.value) ? param.value[1] : undefined;
    return typeof value === "number" ? [{ param, value }] : [];
  });
  entries.sort((a, b) => b.value - a.value);
  const shown = entries.slice(0, TOOLTIP_MAX_SERIES);
  const hidden = entries.length - shown.length;

  const header = `<div style="color:${theme.ink.muted};margin-bottom:4px">${escapeHTML(
    params[0]?.axisValueLabel ?? "",
  )}</div>`;
  const rows = shown.map(
    ({ param, value }) =>
      `<div style="display:flex;align-items:center;justify-content:space-between;gap:12px">` +
      `<span style="max-width:320px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">` +
      `${param.marker ?? ""}${escapeHTML(param.seriesName ?? "")}</span>` +
      `<span style="font-weight:600;color:${theme.ink.primary}">${formatValue(value, unit)}</span>` +
      `</div>`,
  );
  const footer =
    hidden > 0
      ? `<div style="color:${theme.ink.muted};margin-top:4px">… ${hidden} more series</div>`
      : "";
  return header + rows.join("") + footer;
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
      // hideOverlap: narrow panels would otherwise render colliding
      // time labels (ECharts only auto-thins, it does not drop them).
      axisLabel: { color: theme.ink.muted, fontSize: 11, hideOverlap: true },
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
      textStyle: { color: theme.ink.secondary, fontSize: 12 },
      formatter: (params: TooltipParam | TooltipParam[]) =>
        buildTooltipHTML(Array.isArray(params) ? params : [params], unit, theme),
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
