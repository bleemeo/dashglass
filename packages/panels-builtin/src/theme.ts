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
  /**
   * Continuous single-hue ramp for magnitude encodings (heatmaps), low →
   * high. The low end recedes toward the surface by design ("near zero"),
   * so the ramp is mode-specific: light→dark on the light surface,
   * dark→light on the dark one.
   */
  sequential: string[];
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
  // Blue ramp steps 100→700; low values recede toward the light surface.
  sequential: [
    "#cde2fb",
    "#9ec5f4",
    "#6da7ec",
    "#3987e5",
    "#256abf",
    "#184f95",
    "#0d366b",
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
  // Same blue ramp reversed (650→150): low values recede toward the dark
  // surface, high values come forward as light steps.
  sequential: [
    "#104281",
    "#184f95",
    "#256abf",
    "#3987e5",
    "#5598e7",
    "#86b6ef",
    "#b7d3f6",
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

/** "#rrggbb" → "rgba(r,g,b,alpha)". */
export function withAlpha(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

const ChartThemeContext = createContext<ChartTheme>(lightChartTheme);

export const ChartThemeProvider = ChartThemeContext.Provider;

export function useChartTheme(): ChartTheme {
  return useContext(ChartThemeContext);
}
