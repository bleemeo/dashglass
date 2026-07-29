import { useMemo } from "react";

import type { PanelProps } from "@dashglass/runtime";

import { NoData } from "../NoData";
import { parseSpec } from "../spec";
import { useChartTheme } from "../theme";
import { calculate } from "../stat/calculations";
import {
  hexPoints,
  layoutHoneycomb,
  mapStatus,
  orderBySeverity,
  seriesLabel,
  statusColor,
  statusGlyphPath,
  statusSpecSchema,
  summarize,
  type StatusItem,
  type StatusState,
} from "./options";

const SUMMARY_CHAR: Record<StatusState, string> = {
  good: "✓",
  warning: "!",
  serious: "‼",
  critical: "✕",
  unknown: "?",
};

/**
 * A honeycomb of status tiles: one hexagon per series, colored by its
 * mapped state, with a glyph inside (so it never reads as a heatmap) and
 * a header summary of the counts. One series → a single tile; many → a
 * packed honeycomb. Pure HTML/SVG, no canvas.
 */
export function StatusGrid({ spec, data }: PanelProps) {
  const theme = useChartTheme();
  const parsed = useMemo(() => parseSpec(statusSpecSchema, spec), [spec]);

  const items: StatusItem[] = useMemo(() => {
    const mappings = parsed.valueMappings ?? [];
    return data.series.map((series) => {
      const value = calculate(series.points, parsed.calculation ?? "last");
      const mapped = mapStatus(value, mappings, parsed.fallbackStatus ?? "unknown");
      return {
        name: seriesLabel(series, parsed.nameLabel),
        status: mapped.status,
        text: mapped.text,
      };
    });
  }, [data.series, parsed]);

  if (data.state === "ready" && items.length === 0) {
    return <NoData />;
  }

  // Summary counts every series; the grid may then be sorted worst-first
  // and capped, so a few problems stay visible in a large honeycomb.
  const summary = summarize(items);
  const ordered =
    parsed.sort === "none" ? items : orderBySeverity(items);
  const shown =
    parsed.maxTiles && ordered.length > parsed.maxTiles
      ? ordered.slice(0, parsed.maxTiles)
      : ordered;
  const overflow = ordered.length - shown.length;
  const layout = layoutHoneycomb(shown.length, parsed.columns);
  const glyphStroke = Math.max(1.4, layout.radius * 0.14);

  return (
    <div
      className="dashglass-status"
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        padding: "4px 8px 8px",
        gap: 8,
      }}
    >
      <div
        className="dashglass-status-summary"
        style={{
          display: "flex",
          gap: 12,
          fontSize: 13,
          fontVariantNumeric: "tabular-nums",
          color: theme.ink.secondary,
        }}
      >
        {summary.map((entry) => (
          <span
            key={entry.status}
            // "✕ 2" alone is cryptic — spell the status out on hover and
            // for assistive tech.
            title={`${entry.count} ${entry.status}`}
            aria-label={`${entry.count} ${entry.status}`}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 4,
              color: statusColor(theme, entry.status),
              fontWeight: 600,
            }}
          >
            {SUMMARY_CHAR[entry.status]} {entry.count}
          </span>
        ))}
        {overflow > 0 ? (
          <span style={{ color: theme.ink.muted }}>+{overflow} more</span>
        ) : null}
      </div>
      <svg
        className="dashglass-status-grid"
        viewBox={`-1 -1 ${layout.width + 2} ${layout.height + 2}`}
        preserveAspectRatio="xMidYMid meet"
        style={{ flex: 1, minHeight: 0, width: "100%" }}
        role="img"
      >
        {shown.map((item, index) => {
          const pos = layout.positions[index]!;
          const color = statusColor(theme, item.status);
          return (
            <g key={index}>
              <title>{`${item.name}: ${item.text}`}</title>
              <polygon
                points={hexPoints(pos.cx, pos.cy, layout.radius)}
                fill={color}
              />
              <path
                d={statusGlyphPath(item.status, pos.cx, pos.cy, layout.radius)}
                stroke="#fff"
                strokeWidth={glyphStroke}
                strokeLinecap="round"
                strokeLinejoin="round"
                fill="none"
              />
            </g>
          );
        })}
      </svg>
    </div>
  );
}
