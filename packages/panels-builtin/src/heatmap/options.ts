import { z } from "zod";

import type { TimeSeries } from "@dashglass/runtime";

import type { EChartsCoreOption } from "../echarts-setup";
import type { ChartTheme } from "../theme";
import { formatValue, type Unit, unitSchema } from "../units";

export const heatmapSpecSchema = z.object({
  /** Unit of the bucket boundaries (the `le` values), e.g. seconds. */
  unit: unitSchema.optional(),
});

export type HeatmapSpec = z.infer<typeof heatmapSpecSchema>;

interface Bucket {
  le: number;
  label: string;
  points: Map<number, number>;
}

function parseLe(raw: string): number {
  return raw === "+Inf" ? Number.POSITIVE_INFINITY : Number(raw);
}

/**
 * Groups histogram-bucket series (labelled `le`) into de-cumulated buckets:
 * Prometheus buckets are cumulative ("≤ le"), the heatmap wants the count
 * *inside* each band. Returns null when the data has no `le` series — the
 * query is not a histogram.
 */
export function toHeatmapBuckets(
  series: TimeSeries[],
  unit: Unit,
): { buckets: Bucket[]; timestamps: number[] } | null {
  const bucketSeries = series
    .filter((oneSeries) => oneSeries.labels["le"] !== undefined)
    .map((oneSeries) => ({
      le: parseLe(oneSeries.labels["le"]!),
      points: oneSeries.points,
    }))
    .filter((bucket) => !Number.isNaN(bucket.le))
    .sort((a, b) => a.le - b.le);
  if (bucketSeries.length === 0) {
    return null;
  }

  const timestampSet = new Set<number>();
  for (const bucket of bucketSeries) {
    for (const [timestamp] of bucket.points) {
      timestampSet.add(timestamp);
    }
  }
  const timestamps = [...timestampSet].sort((a, b) => a - b);

  const cumulative = bucketSeries.map((bucket) => {
    const byTime = new Map<number, number>();
    for (const [timestamp, value] of bucket.points) {
      if (value !== null) {
        byTime.set(timestamp, value);
      }
    }
    return byTime;
  });

  const buckets: Bucket[] = bucketSeries.map((bucket, index) => {
    const label =
      bucket.le === Number.POSITIVE_INFINITY
        ? "+Inf"
        : `≤ ${formatValue(bucket.le, unit)}`;
    const points = new Map<number, number>();
    for (const timestamp of timestamps) {
      const current = cumulative[index]!.get(timestamp);
      if (current === undefined) {
        continue;
      }
      const below = index > 0 ? (cumulative[index - 1]!.get(timestamp) ?? 0) : 0;
      // Clamp: counter resets can make cumulative buckets momentarily
      // non-monotonic; a negative band count is never meaningful.
      points.set(timestamp, Math.max(0, current - below));
    }
    return { le: bucket.le, label, points };
  });

  return { buckets, timestamps };
}

function formatTime(timestamp: number): string {
  const date = new Date(timestamp);
  return `${String(date.getHours()).padStart(2, "0")}:${String(
    date.getMinutes(),
  ).padStart(2, "0")}`;
}

/** Magnitude on a single-hue sequential ramp: time × bucket → count. */
export function buildHeatmapOption(
  series: TimeSeries[],
  spec: HeatmapSpec,
  theme: ChartTheme,
): EChartsCoreOption | null {
  const unit: Unit = spec.unit ?? "none";
  const grouped = toHeatmapBuckets(series, unit);
  if (!grouped) {
    return null;
  }
  const { buckets, timestamps } = grouped;

  const cells: [number, number, number][] = [];
  let maxValue = 0;
  buckets.forEach((bucket, bucketIndex) => {
    timestamps.forEach((timestamp, timeIndex) => {
      const value = bucket.points.get(timestamp);
      if (value !== undefined) {
        cells.push([timeIndex, bucketIndex, value]);
        maxValue = Math.max(maxValue, value);
      }
    });
  });

  return {
    animation: false,
    backgroundColor: "transparent",
    grid: { left: 8, right: 16, top: 12, bottom: 40, containLabel: true },
    xAxis: {
      type: "category",
      data: timestamps.map(formatTime),
      axisLine: { lineStyle: { color: theme.baseline } },
      axisTick: { show: false },
      axisLabel: { color: theme.ink.muted, fontSize: 11 },
    },
    yAxis: {
      type: "category",
      data: buckets.map((bucket) => bucket.label),
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: { color: theme.ink.secondary, fontSize: 11 },
    },
    visualMap: {
      type: "continuous",
      min: 0,
      max: maxValue > 0 ? maxValue : 1,
      inRange: { color: theme.sequential },
      orient: "horizontal",
      left: "center",
      bottom: 0,
      itemHeight: 60,
      calculable: false,
      textStyle: { color: theme.ink.muted, fontSize: 10 },
      formatter: (value: unknown) =>
        formatValue(typeof value === "number" ? value : null, "short"),
    },
    tooltip: {
      confine: true,
      backgroundColor: theme.tooltipBackground,
      borderColor: theme.border,
      textStyle: { color: theme.ink.primary, fontSize: 12 },
      formatter: (params: unknown) => {
        const { data } = params as { data: [number, number, number] };
        const [timeIndex, bucketIndex, value] = data;
        const bucket = buckets[bucketIndex]!;
        return `${formatTime(timestamps[timeIndex]!)} · ${bucket.label}: ${formatValue(value, "short")}`;
      },
    },
    series: [
      {
        type: "heatmap",
        data: cells,
        // A hairline surface gap so adjacent cells read as cells.
        itemStyle: { borderColor: theme.surface, borderWidth: 1 },
        emphasis: { itemStyle: { borderColor: theme.ink.primary } },
      },
    ],
  };
}
