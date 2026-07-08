import { useMemo } from "react";

import type { PanelProps } from "@dashglass/runtime";

import { EChart } from "../EChart";
import { NoData } from "../NoData";
import { parseSpec } from "../spec";
import { useChartTheme } from "../theme";
import { buildBarOption, barSpecSchema } from "./options";

export function BarPanel({ spec, data }: PanelProps) {
  const theme = useChartTheme();
  const parsed = useMemo(() => parseSpec(barSpecSchema, spec), [spec]);
  const option = useMemo(
    () => buildBarOption(data.series, parsed, theme),
    [data.series, parsed, theme],
  );

  if (data.state === "ready" && data.series.length === 0) {
    return <NoData />;
  }
  return <EChart option={option} />;
}
