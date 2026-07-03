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
