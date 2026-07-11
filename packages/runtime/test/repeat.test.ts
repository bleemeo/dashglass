import { describe, expect, it } from "vitest";

import { placeItems, type RepeatableItem } from "../src";

const item = (over: Partial<RepeatableItem>): RepeatableItem => ({
  panelKey: "p",
  x: 0,
  y: 0,
  width: 12,
  height: 8,
  ...over,
});

describe("placeItems", () => {
  it("passes non-repeated items through with a stable key", () => {
    const placed = placeItems([item({ panelKey: "cpu" })]);
    expect(placed).toEqual([
      {
        key: "cpu-0",
        panelKey: "cpu",
        x: 0,
        y: 0,
        width: 12,
        height: 8,
        pinned: null,
      },
    ]);
  });

  it("tiles a horizontal repeat across the grid width and pins each value", () => {
    const placed = placeItems([
      item({
        panelKey: "cpu",
        repeat: { variable: "instance", values: ["a", "b", "c"] },
      }),
    ]);
    // width 12 in a 24-col grid → 2 per row; 3 values → 2 rows.
    expect(placed.map((p) => [p.x, p.y])).toEqual([
      [0, 0],
      [12, 0],
      [0, 8],
    ]);
    expect(placed.map((p) => p.pinned?.value)).toEqual(["a", "b", "c"]);
    expect(placed.every((p) => p.pinned?.name === "instance")).toBe(true);
  });

  it("pushes the panels below a repeat down by the rows it adds", () => {
    const placed = placeItems([
      item({
        panelKey: "cpu",
        repeat: { variable: "instance", values: ["a", "b", "c"] },
      }),
      item({ panelKey: "foot", y: 8, width: 24, height: 6 }),
    ]);
    // The repeat consumes 2 rows (16) instead of 1 (8): +8 for what follows.
    const foot = placed.find((p) => p.panelKey === "foot");
    expect(foot?.y).toBe(16);
  });

  it("leaves a same-row neighbour in place", () => {
    const placed = placeItems([
      item({
        panelKey: "cpu",
        x: 0,
        repeat: { variable: "instance", values: ["a", "b"] },
      }),
      item({ panelKey: "side", x: 12, y: 0 }),
    ]);
    const side = placed.find((p) => p.panelKey === "side");
    expect(side?.y).toBe(0);
  });

  it("stacks a vertical repeat in a single column", () => {
    const placed = placeItems([
      item({
        panelKey: "cpu",
        repeat: {
          variable: "instance",
          values: ["a", "b", "c"],
          direction: "vertical",
        },
      }),
    ]);
    expect(placed.map((p) => [p.x, p.y])).toEqual([
      [0, 0],
      [0, 8],
      [0, 16],
    ]);
  });

  it("honours maxPerRow", () => {
    const placed = placeItems([
      item({
        panelKey: "cpu",
        width: 6,
        repeat: {
          variable: "instance",
          values: ["a", "b", "c"],
          maxPerRow: 1,
        },
      }),
    ]);
    // maxPerRow 1 forces a single column despite the narrow width.
    expect(placed.map((p) => [p.x, p.y])).toEqual([
      [0, 0],
      [0, 8],
      [0, 16],
    ]);
  });

  it("renders one unpinned instance when the repeat variable has no values", () => {
    const placed = placeItems([
      item({ panelKey: "cpu", repeat: { variable: "instance", values: [] } }),
    ]);
    expect(placed).toHaveLength(1);
    expect(placed[0]?.pinned).toBeNull();
  });
});
