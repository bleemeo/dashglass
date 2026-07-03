import { createContext, useContext } from "react";

/**
 * Charts under the same group id share their axis pointer (ECharts
 * connect): hovering a timestamp on one panel shows the crosshair at the
 * same instant on every other panel — the host provides one id per
 * dashboard.
 */
const ChartGroupContext = createContext<string | undefined>(undefined);

export const ChartGroupProvider = ChartGroupContext.Provider;

export function useChartGroup(): string | undefined {
  return useContext(ChartGroupContext);
}
