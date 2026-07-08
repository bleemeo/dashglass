import { useMemo } from "react";

import type { PanelProps } from "@dashglass/runtime";

import { EChart } from "../EChart";
import { NoData } from "../NoData";
import { parseSpec } from "../spec";
import { useChartTheme } from "../theme";
import { buildTimeSeriesOption, timeSeriesSpecSchema } from "./options";

export function TimeSeriesChart({ spec, data, timeRange, onZoom }: PanelProps) {
  const theme = useChartTheme();
  const parsed = useMemo(() => parseSpec(timeSeriesSpecSchema, spec), [spec]);
  const option = useMemo(
    () => buildTimeSeriesOption(data.series, parsed, theme),
    [data.series, parsed, theme],
  );

  if (data.state === "ready" && data.series.length === 0) {
    return <NoData />;
  }
  return (
    <EChart
      option={option}
      onZoomSelect={
        onZoom
          ? (start, end) => onZoom({ start: new Date(start), end: new Date(end) })
          : undefined
      }
      onDoubleClick={
        onZoom
          ? () => {
              // Double-click zooms out ×2 around the current center.
              const span = timeRange.end.getTime() - timeRange.start.getTime();
              const center = timeRange.start.getTime() + span / 2;
              onZoom({
                start: new Date(center - span),
                end: new Date(Math.min(center + span, Date.now())),
              });
            }
          : undefined
      }
    />
  );
}
