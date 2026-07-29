/**
 * Inline stroke icons (16px, stroke 2, rounded) — same visual family as
 * the ColorModeButton icons in packages/ui; no icon library dependency.
 */

const common = {
  width: 16,
  height: 16,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round",
  strokeLinejoin: "round",
} as const;

/**
 * The Dashglass brand mark: a rounded "pane of glass" tile with a gauge
 * inside — dashboard + glass. Keep in sync with the favicon in index.html.
 *
 * - "solid" (default): brand-blue tile, white gauge — for light/dark
 *   surfaces. Self-contained.
 * - "onBrand": all-white (outlined tile + white gauge) — for the blue
 *   brand gradient, where the solid blue tile would vanish.
 */
export function BrandMark({
  size = 20,
  tone = "solid",
}: {
  size?: number;
  tone?: "solid" | "onBrand";
}) {
  const gauge = "#fff";
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden>
      <rect
        x="2"
        y="2"
        width="20"
        height="20"
        rx="5"
        fill={tone === "onBrand" ? "none" : "#2a78d6"}
        stroke={tone === "onBrand" ? "#fff" : "none"}
        strokeWidth={tone === "onBrand" ? 1.5 : 0}
      />
      <path
        d="M8.46 15.54 A5 5 0 1 1 15.54 15.54"
        stroke={gauge}
        strokeOpacity="0.4"
        strokeWidth="2"
        fill="none"
        strokeLinecap="round"
      />
      <path
        d="M8.46 15.54 A5 5 0 1 1 16.33 9.5"
        stroke={gauge}
        strokeWidth="2"
        fill="none"
        strokeLinecap="round"
      />
      <circle cx="16.33" cy="9.5" r="1.4" fill={gauge} />
    </svg>
  );
}

export function RefreshIcon() {
  return (
    <svg {...common} aria-hidden>
      <path d="M21 12a9 9 0 1 1-2.64-6.36M21 3v6h-6" />
    </svg>
  );
}

export function EditIcon() {
  return (
    <svg {...common} aria-hidden>
      <path d="M17 3a2.8 2.8 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z" />
    </svg>
  );
}

export function CodeIcon() {
  return (
    <svg {...common} aria-hidden>
      <path d="m16 18 6-6-6-6M8 6l-6 6 6 6" />
    </svg>
  );
}

export function KioskIcon() {
  return (
    <svg {...common} aria-hidden>
      <path d="M8 3H5a2 2 0 0 0-2 2v3m13-5h3a2 2 0 0 1 2 2v3M8 21H5a2 2 0 0 1-2-2v-3m13 5h3a2 2 0 0 0 2-2v-3" />
    </svg>
  );
}

export function ClockIcon() {
  return (
    <svg {...common} aria-hidden>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 3" />
    </svg>
  );
}

export function PlusIcon() {
  return (
    <svg {...common} aria-hidden>
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

/** Horizontal ellipsis: per-item overflow menu. */
export function MoreIcon() {
  return (
    <svg {...common} aria-hidden>
      <circle cx="5" cy="12" r="0.75" fill="currentColor" />
      <circle cx="12" cy="12" r="0.75" fill="currentColor" />
      <circle cx="19" cy="12" r="0.75" fill="currentColor" />
    </svg>
  );
}

/** Clock with a counter-clockwise arrow: version history. */
export function HistoryIcon() {
  return (
    <svg {...common} aria-hidden>
      <path d="M3 12a9 9 0 1 0 3-6.7L3 8" />
      <path d="M3 3v5h5" />
      <path d="M12 7v5l3 3" />
    </svg>
  );
}

export function DashboardsIcon() {
  return (
    <svg {...common} aria-hidden>
      <rect x="3" y="3" width="7" height="9" rx="1" />
      <rect x="14" y="3" width="7" height="5" rx="1" />
      <rect x="14" y="12" width="7" height="9" rx="1" />
      <rect x="3" y="16" width="7" height="5" rx="1" />
    </svg>
  );
}

export function ExploreIcon() {
  return (
    <svg {...common} aria-hidden>
      <circle cx="12" cy="12" r="9" />
      <path d="m15.5 8.5-2 5-5 2 2-5 5-2z" />
    </svg>
  );
}

export function SidebarIcon() {
  return (
    <svg {...common} aria-hidden>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M9 4v16" />
    </svg>
  );
}

export function AdminIcon() {
  return (
    <svg {...common} aria-hidden>
      <path d="M12 2 4 5v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V5l-8-3z" />
      <path d="m9 12 2 2 4-4" />
    </svg>
  );
}
