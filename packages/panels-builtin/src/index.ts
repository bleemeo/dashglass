import type { PanelRegistry } from "@polarisui/runtime";

import { GaugeChart } from "./gauge/GaugeChart";
import { StatChart } from "./stat/StatChart";
import { TablePanel } from "./table/TablePanel";
import { TimeSeriesChart } from "./time-series/TimeSeriesChart";

/** Registers the built-in panel kinds. */
export function registerBuiltinPanels(panels: PanelRegistry): void {
  panels.register({ kind: "TimeSeriesChart", component: TimeSeriesChart });
  panels.register({
    kind: "StatChart",
    component: StatChart,
    defaultSpec: { sparkline: true },
  });
  panels.register({ kind: "GaugeChart", component: GaugeChart });
  panels.register({ kind: "Table", component: TablePanel });
}

export {
  ChartThemeProvider,
  darkChartTheme,
  lightChartTheme,
  seriesColor,
  useChartTheme,
  type ChartTheme,
} from "./theme";
export { formatValue, type Unit } from "./units";
export { EChart, type EChartProps } from "./EChart";
export {
  TimeSeriesChart,
} from "./time-series/TimeSeriesChart";
export {
  buildTimeSeriesOption,
  timeSeriesSpecSchema,
  type TimeSeriesSpec,
} from "./time-series/options";
export { StatChart, statSpecSchema, type StatSpec } from "./stat/StatChart";
export {
  calculate,
  calculationSchema,
  type Calculation,
} from "./stat/calculations";
export { GaugeChart } from "./gauge/GaugeChart";
export {
  buildGaugeOption,
  gaugeSpecSchema,
  gaugeStatus,
  type GaugeSpec,
} from "./gauge/options";
export {
  TablePanel,
  tableColumns,
  tableSpecSchema,
  type TableSpec,
} from "./table/TablePanel";
