import { useEffect, useRef } from "react";

import { echarts, type EChartsCoreOption } from "./echarts-setup";

export interface EChartProps {
  option: EChartsCoreOption;
}

/**
 * Minimal React wrapper: init on mount, notMerge setOption on updates,
 * resize with the container, dispose on unmount.
 */
export function EChart({ option }: EChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<ReturnType<typeof echarts.init> | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }
    const chart = echarts.init(container);
    chartRef.current = chart;
    const observer = new ResizeObserver(() => chart.resize());
    observer.observe(container);
    return () => {
      observer.disconnect();
      chart.dispose();
      chartRef.current = null;
    };
  }, []);

  useEffect(() => {
    chartRef.current?.setOption(option, { notMerge: true });
  }, [option]);

  return (
    <div
      ref={containerRef}
      className="polaris-echart"
      style={{ width: "100%", height: "100%", minHeight: 0 }}
    />
  );
}
