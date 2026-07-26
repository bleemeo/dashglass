import { describe, expect, it } from "vitest";

import { createRegistries } from "@dashglass/runtime";

import { registerBuiltinPanels } from "../src";

// The canonical set of built-in panel kinds. When this changes, update the
// panel lists in README.md, DESIGN.md §13 and docs/user-guide.md to match —
// this test is the tripwire that reminds you. (They had already drifted once,
// when `image` and `clock` shipped without a docs update.) See CONTRIBUTING.md
// → "Landing a feature".
const EXPECTED_PANEL_KINDS = [
  "BarChart",
  "Clock",
  "GaugeChart",
  "HeatmapChart",
  "Image",
  "Markdown",
  "StatChart",
  "StatusGrid",
  "Table",
  "TimeSeriesChart",
];

describe("built-in panel registry", () => {
  it("registers exactly the documented set of kinds", () => {
    const registries = createRegistries();
    registerBuiltinPanels(registries.panels);
    const kinds = registries.panels.list().map((plugin) => plugin.kind);
    expect(kinds.slice().sort()).toEqual(EXPECTED_PANEL_KINDS.slice().sort());
  });
});
