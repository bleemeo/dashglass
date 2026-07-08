import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

/** What the user asked for; `system` follows the OS preference live. */
export type ColorModePreference = "light" | "dark" | "system";

/** What is actually applied to the page. */
export type ResolvedColorMode = "light" | "dark";

export const COLOR_MODE_STORAGE_KEY = "dashglass-color-mode";

const DARK_QUERY = "(prefers-color-scheme: dark)";

export function readStoredColorMode(): ColorModePreference {
  if (typeof window === "undefined") {
    return "system";
  }
  try {
    const stored = window.localStorage.getItem(COLOR_MODE_STORAGE_KEY);
    return stored === "light" || stored === "dark" || stored === "system"
      ? stored
      : "system";
  } catch {
    // Storage can be unavailable (privacy mode); fall back silently.
    return "system";
  }
}

function systemColorMode(): ResolvedColorMode {
  if (typeof window === "undefined" || !window.matchMedia) {
    return "light";
  }
  return window.matchMedia(DARK_QUERY).matches ? "dark" : "light";
}

/**
 * Applies the resolved mode to the document root. The `dark` class is what
 * Chakra's `_dark` condition matches; `data-theme` is the hook for plain
 * CSS; `color-scheme` fixes native controls and scrollbars. Kept in sync
 * with the inline no-flash snippet in the app's index.html.
 */
function applyColorMode(resolved: ResolvedColorMode) {
  const root = document.documentElement;
  root.classList.toggle("dark", resolved === "dark");
  root.dataset.theme = resolved;
  root.style.colorScheme = resolved;
}

export interface ColorModeContextValue {
  preference: ColorModePreference;
  resolved: ResolvedColorMode;
  setPreference: (preference: ColorModePreference) => void;
}

const ColorModeContext = createContext<ColorModeContextValue | null>(null);

export function ColorModeProvider({ children }: { children: ReactNode }) {
  const [preference, setPreferenceState] =
    useState<ColorModePreference>(readStoredColorMode);
  const [system, setSystem] = useState<ResolvedColorMode>(systemColorMode);

  const resolved = preference === "system" ? system : preference;

  // Track the OS preference so `system` mode follows it live.
  useEffect(() => {
    if (!window.matchMedia) {
      return;
    }
    const query = window.matchMedia(DARK_QUERY);
    const onChange = () => setSystem(query.matches ? "dark" : "light");
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);

  // Layout effect: restyle before paint when the mode flips.
  useLayoutEffect(() => {
    applyColorMode(resolved);
  }, [resolved]);

  const setPreference = useCallback((next: ColorModePreference) => {
    setPreferenceState(next);
    try {
      window.localStorage.setItem(COLOR_MODE_STORAGE_KEY, next);
    } catch {
      // Not persisting is fine; the mode still applies for this session.
    }
  }, []);

  const value = useMemo(
    () => ({ preference, resolved, setPreference }),
    [preference, resolved, setPreference],
  );

  return (
    <ColorModeContext.Provider value={value}>
      {children}
    </ColorModeContext.Provider>
  );
}

export function useColorMode(): ColorModeContextValue {
  const context = useContext(ColorModeContext);
  if (!context) {
    throw new Error("useColorMode requires a <ColorModeProvider> ancestor");
  }
  return context;
}
