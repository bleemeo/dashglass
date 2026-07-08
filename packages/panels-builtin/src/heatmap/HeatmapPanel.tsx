import { useMemo } from "react";

import type { PanelProps } from "@dashglass/runtime";

import { EChart } from "../EChart";
import { NoData } from "../NoData";
import { parseSpec } from "../spec";
import { useChartTheme } from "../theme";
import { buildHeatmapOption, heatmapSpecSchema } from "./options";

export function HeatmapPanel({ spec, data }: PanelProps) {
  const theme = useChartTheme();
  const parsed = useMemo(() => parseSpec(heatmapSpecSchema, spec), [spec]);
  const option = useMemo(
    () => buildHeatmapOption(data.series, parsed, theme),
    [data.series, parsed, theme],
  );

  if (data.state === "ready" && data.series.length === 0) {
    return <NoData />;
  }
  if (data.state === "ready" && option === null) {
    return (
      <p className="dashglass-panel-unknown">
        No histogram buckets — the query must keep the “le” label, e.g.{" "}
        <code>sum by (le) (rate(…_bucket[5m]))</code>.
      </p>
    );
  }
  if (option === null) {
    return null;
  }
  return <EChart option={option} />;
}
