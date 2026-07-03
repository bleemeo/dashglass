import { z } from "zod";

import type { EChartsCoreOption } from "../echarts-setup";
import type { ChartTheme } from "../theme";
import { formatValue, type Unit, unitSchema } from "../units";

export const gaugeSpecSchema = z.object({
  unit: unitSchema.optional(),
  min: z.number().optional(),
  max: z.number().optional(),
  /**
   * Ordered status boundaries: the gauge is "good" below the first value,
   * then takes each threshold's status from its value upward.
   */
  thresholds: z
    .array(
      z.object({
        value: z.number(),
        status: z.enum(["warning", "serious", "critical"]),
      }),
    )
    .optional(),
});

export type GaugeSpec = z.infer<typeof gaugeSpecSchema>;

/** Status of a value against the spec thresholds. */
export function gaugeStatus(
  value: number,
  spec: GaugeSpec,
): "good" | "warning" | "serious" | "critical" {
  let status: "good" | "warning" | "serious" | "critical" = "good";
  for (const threshold of spec.thresholds ?? []) {
    if (value >= threshold.value) {
      status = threshold.status;
    }
  }
  return status;
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
        pointer: { show: false },
        progress: {
          show: true,
          width: 12,
          roundCap: true,
          itemStyle: { color },
        },
        axisLine: {
          roundCap: true,
          lineStyle: { width: 12, color: [[1, theme.gridline]] },
        },
        axisTick: { show: false },
        splitLine: { show: false },
        axisLabel: { show: false },
        data: [{ value: value ?? min }],
        detail: {
          offsetCenter: [0, 0],
          fontSize: 24,
          fontWeight: 600,
          color: theme.ink.primary,
          formatter: () => formatValue(value, unit),
        },
      },
    ],
  };
}
