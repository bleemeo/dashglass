import type { PanelRegistry } from "@polarisui/runtime";

import { GaugeChart } from "./gauge/GaugeChart";
import { GaugeEditor } from "./gauge/editor";
import { StatChart } from "./stat/StatChart";
import { StatEditor } from "./stat/editor";
import { TablePanel } from "./table/TablePanel";
import { TableEditor } from "./table/editor";
import { TimeSeriesChart } from "./time-series/TimeSeriesChart";
import { TimeSeriesEditor } from "./time-series/editor";

/** Registers the built-in panel kinds. */
export function registerBuiltinPanels(panels: PanelRegistry): void {
  panels.register({
    kind: "TimeSeriesChart",
    displayName: "Time series",
    component: TimeSeriesChart,
    editor: TimeSeriesEditor,
  });
  panels.register({
    kind: "StatChart",
    displayName: "Stat",
    component: StatChart,
    editor: StatEditor,
    defaultSpec: { sparkline: true },
  });
  panels.register({
    kind: "GaugeChart",
    displayName: "Gauge",
    component: GaugeChart,
    editor: GaugeEditor,
  });
  panels.register({
    kind: "Table",
    displayName: "Table",
    component: TablePanel,
    editor: TableEditor,
  });
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
export { TimeSeriesEditor } from "./time-series/editor";
export { StatEditor } from "./stat/editor";
export { GaugeEditor } from "./gauge/editor";
export { TableEditor } from "./table/editor";
export {
  CheckboxField,
  Field,
  NumberField,
  SelectField,
  UNIT_OPTIONS,
  withSpecValue,
} from "./editor/controls";
