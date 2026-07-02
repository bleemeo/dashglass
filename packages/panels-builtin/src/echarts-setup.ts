/**
 * ECharts is imported through echarts/core with only the pieces the
 * built-in panels use, keeping the bundle lean (the panel is the heaviest
 * dependency of the whole UI).
 */
import { GaugeChart, LineChart } from "echarts/charts";
import {
  GridComponent,
  LegendComponent,
  TooltipComponent,
} from "echarts/components";
import * as echarts from "echarts/core";
import { CanvasRenderer } from "echarts/renderers";

echarts.use([
  LineChart,
  GaugeChart,
  GridComponent,
  TooltipComponent,
  LegendComponent,
  CanvasRenderer,
]);

export { echarts };
export type { EChartsCoreOption } from "echarts/core";
