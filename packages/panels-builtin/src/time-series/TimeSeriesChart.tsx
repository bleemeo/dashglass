import { useMemo } from "react";

import type { PanelProps } from "@polarisui/runtime";

import { EChart } from "../EChart";
import { NoData } from "../NoData";
import { parseSpec } from "../spec";
import { useChartTheme } from "../theme";
import { buildTimeSeriesOption, timeSeriesSpecSchema } from "./options";

export function TimeSeriesChart({ spec, data }: PanelProps) {
  const theme = useChartTheme();
  const parsed = useMemo(() => parseSpec(timeSeriesSpecSchema, spec), [spec]);
  const option = useMemo(
    () => buildTimeSeriesOption(data.series, parsed, theme),
    [data.series, parsed, theme],
  );

  if (data.state === "ready" && data.series.length === 0) {
    return <NoData />;
  }
  return <EChart option={option} />;
}
