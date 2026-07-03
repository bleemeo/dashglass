import { useEffect, useRef } from "react";

import { echarts, type EChartsCoreOption } from "./echarts-setup";
import { useChartGroup } from "./group";

export interface EChartProps {
  option: EChartsCoreOption;
  /** Fired when the user brush-selects a time span (x axis values, ms). */
  onZoomSelect?: ((start: number, end: number) => void) | undefined;
  /** Fired on double-click anywhere on the chart. */
  onDoubleClick?: (() => void) | undefined;
}

interface DataZoomEvent {
  batch?: { startValue?: number; endValue?: number }[];
}

/**
 * Minimal React wrapper: init on mount, notMerge setOption on updates,
 * resize with the container, dispose on unmount. When onZoomSelect is
 * set, the drag-to-select zoom mode is kept active (the option must
 * register the hidden toolbox dataZoom feature for it to exist).
 */
export function EChart({ option, onZoomSelect, onDoubleClick }: EChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<ReturnType<typeof echarts.init> | null>(null);
  const group = useChartGroup();
  // Handlers live in refs so chart init doesn't depend on their identity.
  const zoomRef = useRef(onZoomSelect);
  zoomRef.current = onZoomSelect;
  const doubleClickRef = useRef(onDoubleClick);
  doubleClickRef.current = onDoubleClick;
  const optionRef = useRef(option);
  optionRef.current = option;

  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }
    const chart = echarts.init(container);
    chartRef.current = chart;
    if (group) {
      // Shared crosshair: charts of the same group sync their axis pointer.
      chart.group = group;
      echarts.connect(group);
    }
    // Apply the current option straight away: on a group-triggered re-init
    // the option effect below won't fire (option identity is unchanged).
    chart.setOption(optionRef.current, { notMerge: true });
    chart.on("datazoom", (event) => {
      const range = (event as DataZoomEvent).batch?.[0];
      if (
        zoomRef.current &&
        typeof range?.startValue === "number" &&
        typeof range?.endValue === "number" &&
        range.endValue > range.startValue
      ) {
        zoomRef.current(range.startValue, range.endValue);
      }
    });
    chart.getZr().on("dblclick", () => doubleClickRef.current?.());
    const observer = new ResizeObserver(() => chart.resize());
    observer.observe(container);
    return () => {
      observer.disconnect();
      chart.dispose();
      chartRef.current = null;
    };
    // Re-init when the group changes (rare: dashboards are keyed).
  }, [group]);

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) {
      return;
    }
    chart.setOption(option, { notMerge: true });
    if (onZoomSelect) {
      // notMerge resets the interaction state: re-arm drag-to-select.
      chart.dispatchAction({
        type: "takeGlobalCursor",
        key: "dataZoomSelect",
        dataZoomSelectActive: true,
      });
    }
  }, [option, onZoomSelect]);

  return (
    <div
      ref={containerRef}
      className="polaris-echart"
      style={{ width: "100%", height: "100%", minHeight: 0 }}
    />
  );
}
