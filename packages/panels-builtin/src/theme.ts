import { createContext, useContext } from "react";

/**
 * Chart theme tokens. The default values are a brand-neutral, validated
 * palette (colorblind-safe adjacency ordering, contrast checked against
 * both surfaces); packages/ui or a host app substitutes its own brand by
 * providing another ChartTheme through <ChartThemeProvider>.
 */
export interface ChartTheme {
  mode: "light" | "dark";
  /**
   * Categorical series slots, in fixed order — the ordering is the
   * colorblind-safety mechanism (it maximizes adjacent-pair separation),
   * so assign by index, never re-sort or skip.
   */
  series: string[];
  /** Reserved state colors (gauge thresholds); never used for series. */
  status: {
    good: string;
    warning: string;
    serious: string;
    critical: string;
  };
  ink: { primary: string; secondary: string; muted: string };
  gridline: string;
  baseline: string;
  surface: string;
  tooltipBackground: string;
  border: string;
}

export const lightChartTheme: ChartTheme = {
  mode: "light",
  series: [
    "#2a78d6", // blue
    "#1baf7a", // aqua
    "#eda100", // yellow
    "#008300", // green
    "#4a3aa7", // violet
    "#e34948", // red
    "#e87ba4", // magenta
    "#eb6834", // orange
  ],
  status: {
    good: "#0ca30c",
    warning: "#fab219",
    serious: "#ec835a",
    critical: "#d03b3b",
  },
  ink: { primary: "#0b0b0b", secondary: "#52514e", muted: "#898781" },
  gridline: "#e1e0d9",
  baseline: "#c3c2b7",
  surface: "#fcfcfb",
  tooltipBackground: "#fcfcfbf2",
  border: "rgba(11,11,11,0.10)",
};

export const darkChartTheme: ChartTheme = {
  ...lightChartTheme,
  mode: "dark",
  // Same hues re-stepped for the dark surface, validated as a set.
  series: [
    "#3987e5",
    "#199e70",
    "#c98500",
    "#008300",
    "#9085e9",
    "#e66767",
    "#d55181",
    "#d95926",
  ],
  ink: { primary: "#ffffff", secondary: "#c3c2b7", muted: "#898781" },
  gridline: "#2c2c2a",
  baseline: "#383835",
  surface: "#1a1a19",
  tooltipBackground: "#1a1a19f2",
  border: "rgba(255,255,255,0.10)",
};

/**
 * Color for the n-th series. Past the 8 slots the palette repeats; the
 * caller must then add a secondary encoding (the time-series builder
 * switches to dashed lines) so repeats stay distinguishable.
 */
export function seriesColor(theme: ChartTheme, index: number): string {
  return theme.series[index % theme.series.length]!;
}

const ChartThemeContext = createContext<ChartTheme>(lightChartTheme);

export const ChartThemeProvider = ChartThemeContext.Provider;

export function useChartTheme(): ChartTheme {
  return useContext(ChartThemeContext);
}
