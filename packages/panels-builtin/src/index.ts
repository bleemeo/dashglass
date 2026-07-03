import { lazy } from "react";

import type { PanelRegistry } from "@polarisui/runtime";

import { GaugeEditor } from "./gauge/editor";
import { StatEditor } from "./stat/editor";
import { TableEditor } from "./table/editor";
import { TimeSeriesEditor } from "./time-series/editor";

/**
 * Registers the built-in panel kinds. Chart components are registered
 * lazily so the app's main chunk stays free of ECharts; the runtime's
 * PanelChrome provides the Suspense boundary.
 */
export function registerBuiltinPanels(panels: PanelRegistry): void {
  panels.register({
    kind: "TimeSeriesChart",
    displayName: "Time series",
    component: lazy(() =>
      import("./time-series/TimeSeriesChart").then((module) => ({
        default: module.TimeSeriesChart,
      })),
    ),
    editor: TimeSeriesEditor,
  });
  panels.register({
    kind: "StatChart",
    displayName: "Stat",
    component: lazy(() =>
      import("./stat/StatChart").then((module) => ({
        default: module.StatChart,
      })),
    ),
    editor: StatEditor,
    defaultSpec: { sparkline: true },
  });
  panels.register({
    kind: "GaugeChart",
    displayName: "Gauge",
    component: lazy(() =>
      import("./gauge/GaugeChart").then((module) => ({
        default: module.GaugeChart,
      })),
    ),
    editor: GaugeEditor,
  });
  panels.register({
    kind: "Table",
    displayName: "Table",
    component: lazy(() =>
      import("./table/TablePanel").then((module) => ({
        default: module.TablePanel,
      })),
    ),
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
// Chart components are deliberately NOT re-exported here: the root entry
// must stay ECharts-free so the lazy registrations above actually split
// the chart code out of the host's main chunk. Import a component from
// its module (e.g. "@polarisui/panels-builtin/src/EChart") if you need it
// eagerly; the pure option builders and spec schemas below are enough for
// tests and theming.
export {
  buildTimeSeriesOption,
  timeSeriesSpecSchema,
  type TimeSeriesSpec,
} from "./time-series/options";
export { statSpecSchema, type StatSpec } from "./stat/StatChart";
export {
  calculate,
  calculationSchema,
  type Calculation,
} from "./stat/calculations";
export {
  buildGaugeOption,
  gaugeSpecSchema,
  gaugeStatus,
  type GaugeSpec,
} from "./gauge/options";
export { tableSpecSchema, type TableSpec } from "./table/TablePanel";
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
