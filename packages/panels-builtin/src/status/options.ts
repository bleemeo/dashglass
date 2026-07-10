import { z } from "zod";

import type { TimeSeries } from "@dashglass/runtime";

import { calculationSchema } from "../stat/calculations";
import type { ChartTheme } from "../theme";

/**
 * Status states for the status grid. Extends the gauge/stat status ramp
 * (good/warning/serious/critical) with an explicit "unknown" for state
 * values that don't map to a health level (rendered neutral, never a
 * series color).
 */
export const statusStateSchema = z.enum([
  "good",
  "warning",
  "serious",
  "critical",
  "unknown",
]);
export type StatusState = z.infer<typeof statusStateSchema>;

/**
 * A value mapping: an exact metric value → a status state and a short
 * label. This is what makes the panel vendor-neutral — the encoding
 * (Glouton's 1=ok, Nagios's 0=ok, a boolean up/down) lives in config,
 * not in code.
 */
export const valueMappingSchema = z.object({
  value: z.number(),
  status: statusStateSchema,
  text: z.string().optional(),
});
export type ValueMapping = z.infer<typeof valueMappingSchema>;

export const statusSpecSchema = z.object({
  /** Value → state/label table (see presets). */
  valueMappings: z.array(valueMappingSchema).optional(),
  /** State for values matching no mapping (default "unknown"). */
  fallbackStatus: statusStateSchema.optional(),
  /** Label whose value names each tile (default: an identifying label). */
  nameLabel: z.string().optional(),
  /** How each series reduces to one value (default: last). */
  calculation: calculationSchema.optional(),
  /** Tiles per honeycomb row (default: derived from the count). */
  columns: z.number().int().min(1).max(64).optional(),
  /** Tile order: worst-first (default) surfaces problems even in a large,
   * shrunk honeycomb; "none" keeps the query's series order. */
  sort: z.enum(["severity", "none"]).optional(),
  /** Cap the drawn tiles (worst kept); the rest collapse to a "+N" note.
   * The summary always counts every series. */
  maxTiles: z.number().int().min(1).max(4096).optional(),
});
export type StatusSpec = z.infer<typeof statusSpecSchema>;

/**
 * Preset mappings for the common state encodings. The editor writes the
 * chosen preset's array into the spec, so the stored dashboard is always
 * explicit and self-describing.
 */
export const STATUS_PRESETS: Record<string, ValueMapping[]> = {
  // Nagios plugin convention: 0=OK, 1=Warning, 2=Critical, 3=Unknown.
  // Confirmed as what Glouton's `_status` metrics use over the Prometheus
  // exposition too (its internal Ok=1 enum is remapped to Nagios codes
  // there — e.g. a critical service reads 2, a warning disk reads 1).
  nagios: [
    { value: 0, status: "good", text: "OK" },
    { value: 1, status: "warning", text: "Warning" },
    { value: 2, status: "critical", text: "Critical" },
    { value: 3, status: "unknown", text: "Unknown" },
  ],
  // Boolean health, e.g. `up` / `probe_success`: 1=up, 0=down.
  boolean: [
    { value: 1, status: "good", text: "Up" },
    { value: 0, status: "critical", text: "Down" },
  ],
};

/** Resolves a value against the mappings, falling back when unmatched. */
export function mapStatus(
  value: number | null,
  mappings: ValueMapping[],
  fallback: StatusState = "unknown",
): { status: StatusState; text: string } {
  if (value !== null) {
    const match = mappings.find((mapping) => mapping.value === value);
    if (match) {
      return { status: match.status, text: match.text ?? String(value) };
    }
  }
  return { status: fallback, text: value === null ? "—" : String(value) };
}

/** Status → reserved state color; "unknown" is neutral ink, never a hue. */
export function statusColor(theme: ChartTheme, status: StatusState): string {
  return status === "unknown" ? theme.ink.muted : theme.status[status];
}

/** Identifying name for a tile: the configured label, else a per-thing
 * label (Glouton's `item`, a service/mountpoint/name, and finally the
 * scrape `instance` for e.g. `up`), else the raw series name. */
export function seriesLabel(series: TimeSeries, nameLabel?: string): string {
  if (nameLabel && series.labels[nameLabel]) {
    return series.labels[nameLabel]!;
  }
  for (const candidate of ["item", "service", "mountpoint", "name", "instance"]) {
    if (series.labels[candidate]) {
      return series.labels[candidate]!;
    }
  }
  return series.name;
}

export interface StatusItem {
  name: string;
  status: StatusState;
  text: string;
}

const STATE_ORDER: StatusState[] = [
  "good",
  "warning",
  "serious",
  "critical",
  "unknown",
];

/** Counts per state, in severity order, for the header summary. */
export function summarize(
  items: StatusItem[],
): { status: StatusState; count: number }[] {
  return STATE_ORDER.map((status) => ({
    status,
    count: items.filter((item) => item.status === status).length,
  })).filter((entry) => entry.count > 0);
}

// Worst → best, so problems land at the top-left of the honeycomb.
const SEVERITY_RANK: Record<StatusState, number> = {
  critical: 0,
  serious: 1,
  warning: 2,
  unknown: 3,
  good: 4,
};

/** Orders items worst-first (stable within a state), so a handful of red
 * tiles stay visible among hundreds of green ones. */
export function orderBySeverity(items: StatusItem[]): StatusItem[] {
  return items
    .map((item, index) => ({ item, index }))
    .sort(
      (a, b) =>
        SEVERITY_RANK[a.item.status] - SEVERITY_RANK[b.item.status] ||
        a.index - b.index,
    )
    .map((entry) => entry.item);
}

/** Default column count: a pleasant, slightly-wide honeycomb. */
export function honeycombColumns(count: number): number {
  if (count <= 1) return 1;
  return Math.min(count, Math.max(1, Math.round(Math.sqrt(count * 2.4))));
}

export interface HexLayout {
  positions: { cx: number; cy: number }[];
  width: number;
  height: number;
  /** Draw radius (slightly under the cell radius, so tiles keep a gap and
   * never read as a contiguous heatmap). */
  radius: number;
}

// Pointy-top hexagons in offset rows (the row-shifted honeycomb of the
// reference status widgets). Cell radius R; adjacent centers sit √3·R
// apart across a row and 1.5·R down between rows, odd rows shifted half a
// column. Tiles are drawn at 0.9·R, leaving a visible gap.
const R = 10;

export function layoutHoneycomb(count: number, columns?: number): HexLayout {
  const cols = Math.max(1, columns ?? honeycombColumns(count));
  const rows = Math.max(1, Math.ceil(count / cols));
  const dx = Math.sqrt(3) * R;
  const dy = 1.5 * R;
  const offsetRow = count > cols; // only shift when there's a second row
  const positions: { cx: number; cy: number }[] = [];
  for (let i = 0; i < count; i++) {
    const row = Math.floor(i / cols);
    const col = i % cols;
    const shift = offsetRow && row % 2 === 1 ? dx / 2 : 0;
    positions.push({
      cx: R * Math.sqrt(3) * 0.5 + col * dx + shift,
      cy: R + row * dy,
    });
  }
  const width = cols * dx + (offsetRow ? dx / 2 : 0);
  const height = R + (rows - 1) * dy + R;
  return { positions, width, height, radius: R * 0.9 };
}

/** SVG polygon points for a pointy-top hexagon centered at (cx, cy). */
export function hexPoints(cx: number, cy: number, radius: number): string {
  const points: string[] = [];
  for (let i = 0; i < 6; i++) {
    const angle = ((-90 + 60 * i) * Math.PI) / 180;
    points.push(
      `${(cx + radius * Math.cos(angle)).toFixed(2)},${(
        cy +
        radius * Math.sin(angle)
      ).toFixed(2)}`,
    );
  }
  return points.join(" ");
}

/**
 * SVG path (in a unit box centered on the tile, scaled by `s`) for each
 * state's glyph: check, exclamation, cross, question. Drawn in white on
 * the colored tile — icon + shape + gaps is what keeps the grid from
 * reading as a heatmap.
 */
export function statusGlyphPath(status: StatusState, cx: number, cy: number, s: number): string {
  const p = (x: number, y: number) => `${(cx + x * s).toFixed(2)} ${(cy + y * s).toFixed(2)}`;
  switch (status) {
    case "good":
      return `M ${p(-0.42, 0.02)} L ${p(-0.12, 0.34)} L ${p(0.45, -0.34)}`;
    case "warning":
    case "serious":
      return `M ${p(0, -0.42)} L ${p(0, 0.14)} M ${p(0, 0.32)} L ${p(0, 0.42)}`;
    case "critical":
      return `M ${p(-0.34, -0.34)} L ${p(0.34, 0.34)} M ${p(0.34, -0.34)} L ${p(-0.34, 0.34)}`;
    case "unknown":
      return `M ${p(-0.28, -0.2)} Q ${p(-0.28, -0.44)} ${p(0, -0.44)} Q ${p(0.3, -0.44)} ${p(0.3, -0.16)} Q ${p(0.3, 0.02)} ${p(0, 0.08)} L ${p(0, 0.24)} M ${p(0, 0.38)} L ${p(0, 0.42)}`;
  }
}
