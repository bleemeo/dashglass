import { IconButton } from "@chakra-ui/react";

import {
  useColorMode,
  type ColorModePreference,
} from "./color-mode";

const NEXT: Record<ColorModePreference, ColorModePreference> = {
  system: "light",
  light: "dark",
  dark: "system",
};

const LABEL: Record<ColorModePreference, string> = {
  system: "Color mode: system",
  light: "Color mode: light",
  dark: "Color mode: dark",
};

function Icon({ preference }: { preference: ColorModePreference }) {
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
  switch (preference) {
    case "light":
      return (
        <svg {...common} aria-hidden>
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v2m0 16v2M4.9 4.9l1.4 1.4m11.4 11.4 1.4 1.4M2 12h2m16 0h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
        </svg>
      );
    case "dark":
      return (
        <svg {...common} aria-hidden>
          <path d="M21 12.8A9 9 0 1 1 11.2 3 7 7 0 0 0 21 12.8z" />
        </svg>
      );
    case "system":
      return (
        <svg {...common} aria-hidden>
          <rect x="2" y="4" width="20" height="13" rx="2" />
          <path d="M8 21h8m-4-4v4" />
        </svg>
      );
  }
}

/**
 * Cycles light → dark → system. Shows the current *preference* (system has
 * its own icon so "follows the OS" stays visible and reachable).
 */
export function ColorModeButton() {
  const { preference, setPreference } = useColorMode();
  return (
    <IconButton
      size="xs"
      variant="ghost"
      aria-label={`${LABEL[preference]} — switch to ${NEXT[preference]}`}
      title={LABEL[preference]}
      onClick={() => setPreference(NEXT[preference])}
    >
      <Icon preference={preference} />
    </IconButton>
  );
}
