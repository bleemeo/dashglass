// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import type { PanelData } from "@dashglass/runtime";

import { MarkdownPanel } from "../src/markdown/MarkdownPanel";

afterEach(cleanup);

const noData: PanelData = { state: "ready", series: [], errors: [] };
const timeRange = { start: new Date(0), end: new Date(60_000) };

describe("MarkdownPanel", () => {
  it("renders markdown content", () => {
    render(
      <MarkdownPanel
        spec={{ content: "# Title\n\nSome **bold** text." }}
        data={noData}
        timeRange={timeRange}
      />,
    );
    expect(screen.getByRole("heading", { name: "Title" })).toBeDefined();
    expect(screen.getByText("bold").tagName).toBe("STRONG");
  });

  it("does not render raw HTML", () => {
    const { container } = render(
      <MarkdownPanel
        spec={{ content: 'before <img src="x" onerror="boom()"> after' }}
        data={noData}
        timeRange={timeRange}
      />,
    );
    expect(container.querySelector("img")).toBeNull();
  });
});
