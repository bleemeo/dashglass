import { useMemo } from "react";

import type { PanelProps } from "@polarisui/runtime";

import { EChart } from "../EChart";
import { NoData } from "../NoData";
import { parseSpec } from "../spec";
import { calculate } from "../stat/calculations";
import { useChartTheme } from "../theme";
import { buildGaugeOption, gaugeSpecSchema } from "./options";

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
  return <EChart option={option} />;
}
