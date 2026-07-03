/**
 * ECharts is imported through echarts/core with only the pieces the
 * built-in panels use, keeping the bundle lean (the panel is the heaviest
 * dependency of the whole UI).
 */
import { BarChart, GaugeChart, HeatmapChart, LineChart } from "echarts/charts";
import {
  DataZoomComponent,
  GridComponent,
  LegendComponent,
  ToolboxComponent,
  TooltipComponent,
  VisualMapComponent,
} from "echarts/components";
import * as echarts from "echarts/core";
import { CanvasRenderer } from "echarts/renderers";

echarts.use([
  LineChart,
  BarChart,
  GaugeChart,
  HeatmapChart,
  GridComponent,
  TooltipComponent,
  LegendComponent,
  VisualMapComponent,
  // Brush-select zoom on time series (hidden toolbox + dataZoom).
  ToolboxComponent,
  DataZoomComponent,
  CanvasRenderer,
]);

export { echarts };
export type { EChartsCoreOption } from "echarts/core";
