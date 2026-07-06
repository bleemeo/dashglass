import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PanelErrorBoundary } from "./PanelErrorBoundary";

afterEach(cleanup);

function Bomb({ defused }: { defused: boolean }) {
  if (!defused) {
    throw new Error("kaboom");
  }
  return <p>panel content</p>;
}

describe("PanelErrorBoundary", () => {
  it("replaces a crashing child with an inline error", () => {
    // React logs caught render errors; keep the test output clean.
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      render(
        <PanelErrorBoundary resetKey="a">
          <Bomb defused={false} />
        </PanelErrorBoundary>,
      );
      expect(screen.getByRole("alert").textContent).toContain("kaboom");
    } finally {
      spy.mockRestore();
    }
  });

  it("recovers when resetKey changes", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const { rerender } = render(
        <PanelErrorBoundary resetKey="a">
          <Bomb defused={false} />
        </PanelErrorBoundary>,
      );
      expect(screen.getByRole("alert")).toBeDefined();

      rerender(
        <PanelErrorBoundary resetKey="b">
          <Bomb defused />
        </PanelErrorBoundary>,
      );
      expect(screen.queryByRole("alert")).toBeNull();
      expect(screen.getByText("panel content")).toBeDefined();
    } finally {
      spy.mockRestore();
    }
  });
});
