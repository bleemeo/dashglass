import { useMemo } from "react";
import { z } from "zod";

import type { PanelProps, TimeSeries } from "@dashglass/runtime";

import { NoData } from "../NoData";
import { parseSpec } from "../spec";
import { seriesColor, useChartTheme, type ChartTheme } from "../theme";
import { thresholdStatus, thresholdsSchema } from "../thresholds";
import { formatValueParts, unitSchema } from "../units";
import { calculate, calculationSchema } from "./calculations";

export const statSpecSchema = z.object({
  unit: unitSchema.optional(),
  decimals: z.number().int().min(0).max(6).optional(),
  calculation: calculationSchema.optional(),
  sparkline: z.boolean().optional(),
  thresholds: thresholdsSchema.optional(),
});

export type StatSpec = z.infer<typeof statSpecSchema>;

/** Hero-number color: the status ramp when thresholds are set (a disk at
 * 95% must read as red without reading the number), neutral otherwise. */
export function statValueColor(
  value: number | null,
  spec: StatSpec,
  theme: ChartTheme,
): string {
  if (value === null || !spec.thresholds?.length) {
    return theme.ink.primary;
  }
  return theme.status[thresholdStatus(value, spec.thresholds)];
}

/** A dependency-free sparkline: a normalized SVG polyline, no axes. */
function Sparkline({
  series,
  theme,
}: {
  series: TimeSeries;
  theme: ChartTheme;
}) {
  const points = series.points.filter(
    (point): point is [number, number] => point[1] !== null,
  );
  if (points.length < 2) {
    return null;
  }
  const xs = points.map(([time]) => time);
  const ys = points.map(([, value]) => value);
  const [minX, maxX] = [Math.min(...xs), Math.max(...xs)];
  const [minY, maxY] = [Math.min(...ys), Math.max(...ys)];
  const spanX = maxX - minX || 1;
  const spanY = maxY - minY || 1;
  const path = points
    .map(([time, value]) => {
      const x = ((time - minX) / spanX) * 100;
      const y = 30 - ((value - minY) / spanY) * 28 - 1;
      return `${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(" ");

  return (
    <svg
      className="dashglass-stat-sparkline"
      viewBox="0 0 100 30"
      preserveAspectRatio="none"
      style={{ width: "100%", height: 30, display: "block" }}
      aria-hidden="true"
    >
      <polyline
        points={path}
        fill="none"
        stroke={seriesColor(theme, 0)}
        strokeWidth={1.5}
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

/**
 * Single-value tile: hero number plus optional sparkline. Renders the
 * first series; a stat over a multi-series query should aggregate in
 * PromQL.
 */
export function StatChart({ spec, data }: PanelProps) {
  const theme = useChartTheme();
  const parsed = useMemo(() => parseSpec(statSpecSchema, spec), [spec]);
  const series = data.series[0];
  const value = useMemo(
    () =>
      series ? calculate(series.points, parsed.calculation ?? "last") : null,
    [series, parsed.calculation],
  );

  if (data.state === "ready" && !series) {
    return <NoData />;
  }

  const parts = formatValueParts(value, parsed.unit ?? "none", parsed.decimals);
  return (
    <div
      className="dashglass-stat"
      style={{
        // Container queries so the number fits the panel, not the window.
        containerType: "size",
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        alignItems: "center",
        gap: 6,
        height: "100%",
        padding: "0 8px",
      }}
    >
      <div
        className="dashglass-stat-value"
        style={{
          display: "flex",
          alignItems: "baseline",
          gap: 4,
          fontWeight: 600,
          lineHeight: 1.1,
          color: statValueColor(value, parsed, theme),
        }}
      >
        <span style={{ fontSize: "clamp(32px, 38cqmin, 104px)" }}>
          {parts.value}
        </span>
        {parts.suffix ? (
          <span
            style={{ fontSize: "clamp(15px, 15cqmin, 42px)", opacity: 0.6 }}
          >
            {parts.suffix}
          </span>
        ) : null}
      </div>
      {parsed.sparkline && series ? (
        <Sparkline series={series} theme={theme} />
      ) : null}
    </div>
  );
}
