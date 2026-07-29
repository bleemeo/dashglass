import { useMemo } from "react";

import type { PanelProps } from "@dashglass/runtime";

import { EChart } from "../EChart";
import { NoData } from "../NoData";
import { parseSpec } from "../spec";
import { calculate } from "../stat/calculations";
import { useChartTheme } from "../theme";
import { formatValueParts } from "../units";
import { buildGaugeOption, gaugeSpecSchema, gaugeStatus } from "./options";

export function GaugeChart({ spec, data }: PanelProps) {
  const theme = useChartTheme();
  const parsed = useMemo(() => parseSpec(gaugeSpecSchema, spec), [spec]);
  const series = data.series[0];
  const value = series ? calculate(series.points, "last") : null;
  const option = useMemo(
    () => buildGaugeOption(value, parsed, theme),
    [value, parsed, theme],
  );

  if (data.state === "ready" && !series) {
    return <NoData />;
  }

  const parts = formatValueParts(value, parsed.unit ?? "none");
  const color =
    value !== null && parsed.thresholds?.length
      ? theme.status[gaugeStatus(value, parsed)]
      : theme.ink.primary;
  const min = parsed.min ?? 0;
  const max = parsed.max ?? 100;
  const outOfRange =
    value === null ? null : value > max ? "over max" : value < min ? "under min" : null;

  return (
    // The arc is canvas (ECharts); the value overlays as HTML so it scales
    // with the tile and stays crisp. The overlay sits at the arc center
    // (matching options.ts center: ["50%", "56%"]).
    <div
      className="dashglass-gauge"
      style={{
        position: "relative",
        width: "100%",
        height: "100%",
        containerType: "size",
      }}
    >
      <EChart option={option} />
      <div
        className="dashglass-gauge-value"
        style={{
          position: "absolute",
          top: "56%",
          left: "50%",
          transform: "translate(-50%, -50%)",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 2,
          maxWidth: "90%",
          fontWeight: 600,
          lineHeight: 1,
          color,
          pointerEvents: "none",
        }}
      >
        <div style={{ display: "flex", alignItems: "baseline", gap: 3 }}>
          <span style={{ fontSize: "clamp(22px, 26cqmin, 60px)" }}>
            {parts.value}
          </span>
          {parts.suffix ? (
            <span
              style={{ fontSize: "clamp(12px, 11cqmin, 28px)", opacity: 0.6 }}
            >
              {parts.suffix}
            </span>
          ) : null}
        </div>
        {outOfRange ? (
          <span
            className="dashglass-gauge-overflow"
            style={{
              fontSize: "clamp(10px, 7cqmin, 14px)",
              fontWeight: 500,
              color: theme.ink.muted,
            }}
          >
            {outOfRange}
          </span>
        ) : null}
      </div>
    </div>
  );
}
