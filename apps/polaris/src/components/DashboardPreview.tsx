import { Box, Flex, Text } from "@chakra-ui/react";

import type { PreviewItem } from "../api/client";

const COLS = 24;
// Crop very tall dashboards so the thumbnail keeps a card-like ratio.
const MAX_ROWS = 16;
const GAP = 0.5;
const ACCENT = "#2a78d6";

/** Faux content drawn inside a panel rectangle, hinting at its kind. */
function glyph(item: PreviewItem, kind: string | undefined) {
  const ix = item.x + GAP;
  const iy = item.y + GAP;
  const iw = Math.max(item.w - 2 * GAP, 0.5);
  const ih = Math.max(item.h - 2 * GAP, 0.5);
  const px = (f: number) => ix + f * iw;
  const py = (f: number) => iy + f * ih;

  switch (kind) {
    case "TimeSeriesChart":
    case "BarChart":
    case "HeatmapChart":
      return (
        <polyline
          points={`${px(0.08)},${py(0.72)} ${px(0.3)},${py(0.5)} ${px(0.5)},${py(0.62)} ${px(0.72)},${py(0.32)} ${px(0.92)},${py(0.46)}`}
          fill="none"
          stroke={ACCENT}
          strokeWidth={0.22}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      );
    case "StatChart":
      return (
        <rect
          x={px(0.2)}
          y={py(0.38)}
          width={iw * 0.6}
          height={ih * 0.24}
          rx={0.2}
          fill={ACCENT}
        />
      );
    case "GaugeChart":
      return (
        <path
          d={`M ${px(0.25)} ${py(0.72)} A ${iw * 0.25} ${iw * 0.25} 0 0 1 ${px(0.75)} ${py(0.72)}`}
          fill="none"
          stroke={ACCENT}
          strokeWidth={0.28}
          strokeLinecap="round"
        />
      );
    case "Table":
      return (
        <g stroke="currentColor" strokeOpacity={0.5} strokeWidth={0.14}>
          <line x1={px(0.12)} y1={py(0.32)} x2={px(0.88)} y2={py(0.32)} />
          <line x1={px(0.12)} y1={py(0.55)} x2={px(0.88)} y2={py(0.55)} />
          <line x1={px(0.12)} y1={py(0.78)} x2={px(0.88)} y2={py(0.78)} />
        </g>
      );
    case "Markdown":
      return (
        <g stroke="currentColor" strokeOpacity={0.35} strokeWidth={0.14}>
          <line x1={px(0.12)} y1={py(0.4)} x2={px(0.8)} y2={py(0.4)} />
          <line x1={px(0.12)} y1={py(0.62)} x2={px(0.6)} y2={py(0.62)} />
        </g>
      );
    default:
      return null;
  }
}

/**
 * Schematic thumbnail of a dashboard: its grid layout drawn as small
 * cards with a faux content glyph per panel kind. No queries — cheap and
 * deterministic, so a long list of cards stays fast.
 */
export function DashboardPreview({ preview }: { preview?: PreviewItem[] }) {
  if (!preview || preview.length === 0) {
    return (
      <Flex
        align="center"
        justify="center"
        height="full"
        color="fg.muted"
        fontSize="xs"
      >
        <Text>Empty dashboard</Text>
      </Flex>
    );
  }

  const rows = Math.min(
    Math.max(...preview.map((item) => item.y + item.h), 1),
    MAX_ROWS,
  );

  return (
    <Box color="fg.muted" width="full" height="full">
      <svg
        viewBox={`0 0 ${COLS} ${rows}`}
        width="100%"
        height="100%"
        preserveAspectRatio="xMidYMin meet"
        role="img"
        aria-label="Dashboard layout preview"
      >
        {preview.map((item, index) => (
          <g key={index}>
            <rect
              x={item.x + GAP}
              y={item.y + GAP}
              width={Math.max(item.w - 2 * GAP, 0.5)}
              height={Math.max(item.h - 2 * GAP, 0.5)}
              rx={0.5}
              fill="currentColor"
              fillOpacity={0.12}
              stroke="currentColor"
              strokeOpacity={0.35}
              strokeWidth={0.12}
            />
            {glyph(item, item.kind)}
          </g>
        ))}
      </svg>
    </Box>
  );
}
