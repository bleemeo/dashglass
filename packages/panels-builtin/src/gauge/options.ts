import { z } from "zod";

import type { EChartsCoreOption } from "../echarts-setup";
import { withAlpha, type ChartTheme } from "../theme";
import { thresholdStatus, thresholdsSchema } from "../thresholds";
import { formatValue, type Unit, unitSchema } from "../units";

export const gaugeSpecSchema = z.object({
  unit: unitSchema.optional(),
  min: z.number().optional(),
  max: z.number().optional(),
  thresholds: thresholdsSchema.optional(),
});

export type GaugeSpec = z.infer<typeof gaugeSpecSchema>;

/** Status of a value against the spec thresholds. */
export function gaugeStatus(
  value: number,
  spec: GaugeSpec,
): "good" | "warning" | "serious" | "critical" {
  return thresholdStatus(value, spec.thresholds ?? []);
}

/**
 * Background-track segments marking the threshold zones, as ECharts
 * axisLine color stops ([fraction, color]). Tinted status colors: the
 * progress arc drawn on top keeps the full-strength one, so "how close
 * is the value to the next state" is readable at a glance. Exported for
 * tests.
 */
export function gaugeTrackStops(
  spec: GaugeSpec,
  theme: ChartTheme,
): [number, string][] | null {
  const thresholds = spec.thresholds ?? [];
  if (thresholds.length === 0) {
    return null;
  }
  const min = spec.min ?? 0;
  const max = spec.max ?? 100;
  const span = max - min || 1;
  const stops: [number, string][] = [];
  let zoneColor = theme.status.good;
  for (const threshold of thresholds) {
    const at = Math.min(Math.max((threshold.value - min) / span, 0), 1);
    stops.push([at, withAlpha(zoneColor, 0.4)]);
    zoneColor = theme.status[threshold.status];
  }
  stops.push([1, withAlpha(zoneColor, 0.4)]);
  return stops;
}

export function buildGaugeOption(
  value: number | null,
  spec: GaugeSpec,
  theme: ChartTheme,
): EChartsCoreOption {
  const unit: Unit = spec.unit ?? "none";
  const min = spec.min ?? 0;
  const max = spec.max ?? 100;
  const color =
    value === null
      ? theme.ink.muted
      : spec.thresholds?.length
        ? theme.status[gaugeStatus(value, spec)]
        : theme.series[0]!;

  return {
    animation: false,
    backgroundColor: "transparent",
    series: [
      {
        type: "gauge",
        min,
        max,
        startAngle: 210,
        endAngle: -30,
        // Fill the tile: a large arc leaves room for the overlaid value.
        radius: "96%",
        center: ["50%", "56%"],
        pointer: { show: false },
        progress: {
          show: true,
          width: 14,
          roundCap: true,
          itemStyle: { color },
        },
        axisLine: {
          roundCap: true,
          lineStyle: {
            width: 18,
            color: gaugeTrackStops(spec, theme) ?? [[1, theme.gridline]],
          },
        },
        axisTick: { show: false },
        splitLine: { show: false },
        // Only the min and max labels, at the arc ends, for scale context.
        axisLabel: {
          show: true,
          distance: -4,
          fontSize: 11,
          color: theme.ink.muted,
          formatter: (tick: number) =>
            tick === min || tick === max ? formatValue(tick, unit) : "",
        },
        // Clamp into [min, max]: an out-of-range value would draw a
        // (visually broken) over-full arc; the overflow is signalled by
        // the caption in GaugeChart instead.
        data: [{ value: Math.min(Math.max(value ?? min, min), max) }],
        // The value is rendered as a responsive HTML overlay (see
        // GaugeChart) so it scales with the tile; canvas text can't.
        detail: { show: false },
      },
    ],
  };
}
