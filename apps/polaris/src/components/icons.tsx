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
