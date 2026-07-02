// @vitest-environment jsdom
import { act } from "react";

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  COLOR_MODE_STORAGE_KEY,
  ColorModeProvider,
  readStoredColorMode,
  useColorMode,
} from "../src/color-mode";

type Listener = (event: { matches: boolean }) => void;

function installMatchMedia(initialDark: boolean) {
  let matches = initialDark;
  const listeners = new Set<Listener>();
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    get matches() {
      return matches;
    },
    media: query,
    addEventListener: (_: string, listener: Listener) => listeners.add(listener),
    removeEventListener: (_: string, listener: Listener) =>
      listeners.delete(listener),
  }));
  return {
    setDark(next: boolean) {
      matches = next;
      for (const listener of listeners) {
        listener({ matches: next });
      }
    },
  };
}

function Probe() {
  const { preference, resolved, setPreference } = useColorMode();
  return (
    <div>
      <span data-testid="preference">{preference}</span>
      <span data-testid="resolved">{resolved}</span>
      <button onClick={() => setPreference("dark")}>go-dark</button>
      <button onClick={() => setPreference("system")}>go-system</button>
    </div>
  );
}

describe("ColorModeProvider", () => {
  beforeEach(() => {
    window.localStorage.clear();
    document.documentElement.className = "";
    delete document.documentElement.dataset.theme;
  });
  afterEach(cleanup);

  it("defaults to system and resolves from the OS preference", () => {
    installMatchMedia(true);
    render(
      <ColorModeProvider>
        <Probe />
      </ColorModeProvider>,
    );
    expect(screen.getByTestId("preference").textContent).toBe("system");
    expect(screen.getByTestId("resolved").textContent).toBe("dark");
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(document.documentElement.dataset.theme).toBe("dark");
  });

  it("persists an explicit preference and applies it to the root", () => {
    installMatchMedia(false);
    render(
      <ColorModeProvider>
        <Probe />
      </ColorModeProvider>,
    );
    act(() => screen.getByText("go-dark").click());
    expect(screen.getByTestId("resolved").textContent).toBe("dark");
    expect(window.localStorage.getItem(COLOR_MODE_STORAGE_KEY)).toBe("dark");
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(document.documentElement.style.colorScheme).toBe("dark");
  });

  it("follows live OS changes while in system mode only", () => {
    const media = installMatchMedia(false);
    render(
      <ColorModeProvider>
        <Probe />
      </ColorModeProvider>,
    );
    expect(screen.getByTestId("resolved").textContent).toBe("light");
    act(() => media.setDark(true));
    expect(screen.getByTestId("resolved").textContent).toBe("dark");

    act(() => screen.getByText("go-dark").click());
    act(() => media.setDark(false));
    // Explicit preference wins over the OS change.
    expect(screen.getByTestId("resolved").textContent).toBe("dark");
  });

  it("restores the stored preference on mount", () => {
    installMatchMedia(false);
    window.localStorage.setItem(COLOR_MODE_STORAGE_KEY, "dark");
    expect(readStoredColorMode()).toBe("dark");
    render(
      <ColorModeProvider>
        <Probe />
      </ColorModeProvider>,
    );
    expect(screen.getByTestId("resolved").textContent).toBe("dark");
  });

  it("ignores garbage in storage", () => {
    installMatchMedia(false);
    window.localStorage.setItem(COLOR_MODE_STORAGE_KEY, "blue");
    expect(readStoredColorMode()).toBe("system");
  });
});
