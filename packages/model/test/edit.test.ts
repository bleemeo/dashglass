import { describe, expect, it } from "vitest";

import {
  addLayout,
  addPanel,
  dashboardSchema,
  panelRefFromKey,
  removePanelAt,
  setLayoutTitle,
  uniquePanelKey,
  updateLayoutItems,
  setVariables,
  updatePanel,
  type Panel,
  type Variable,
} from "../src";
import { nodeOverviewDashboard } from "./fixtures";

const statPanel: Panel = {
  kind: "Panel",
  spec: {
    display: { name: "New stat" },
    plugin: { kind: "StatChart", spec: { sparkline: true } },
  },
};

describe("edit operations", () => {
  it("never mutates the input document", () => {
    const dashboard = nodeOverviewDashboard();
    const before = JSON.stringify(dashboard);
    addPanel(dashboard, "new", statPanel, 0);
    removePanelAt(dashboard, 0, 0);
    updateLayoutItems(dashboard, 0, []);
    setLayoutTitle(dashboard, 0, "Renamed");
    expect(JSON.stringify(dashboard)).toBe(before);
  });

  it("generates unused panel keys", () => {
    const dashboard = nodeOverviewDashboard();
    expect(uniquePanelKey(dashboard)).toBe("panel");
    expect(uniquePanelKey(dashboard, "cpu")).toBe("cpu-2");
  });

  it("adds a panel at the bottom of the section and stays schema-valid", () => {
    const dashboard = nodeOverviewDashboard();
    const key = uniquePanelKey(dashboard);
    const next = addPanel(dashboard, key, statPanel, 0);

    expect(next.spec.panels[key]).toEqual(statPanel);
    const item = next.spec.layouts[0]!.spec.items.at(-1)!;
    expect(item.content.$ref).toBe(panelRefFromKey(key));
    const bottom = dashboard.spec.layouts[0]!.spec.items.reduce(
      (max, i) => Math.max(max, i.y + i.height),
      0,
    );
    expect(item.y).toBe(bottom);
    expect(() => dashboardSchema.parse(next)).not.toThrow();
  });

  it("removes an orphaned panel definition with its last layout item", () => {
    const dashboard = nodeOverviewDashboard();
    const items = dashboard.spec.layouts[0]!.spec.items;
    const removedKey = items[0]!.content.$ref.split("/").at(-1)!;

    const next = removePanelAt(dashboard, 0, 0);
    expect(next.spec.layouts[0]!.spec.items).toHaveLength(items.length - 1);
    expect(next.spec.panels[removedKey]).toBeUndefined();
  });

  it("keeps a panel definition referenced by another section", () => {
    let dashboard = nodeOverviewDashboard();
    const ref = dashboard.spec.layouts[0]!.spec.items[0]!.content.$ref;
    dashboard = addLayout(dashboard, "Second");
    dashboard = updateLayoutItems(dashboard, 1, [
      { x: 0, y: 0, width: 6, height: 4, content: { $ref: ref } },
    ]);

    const next = removePanelAt(dashboard, 0, 0);
    const key = ref.split("/").at(-1)!;
    expect(next.spec.panels[key]).toBeDefined();
  });

  it("updates a panel definition in place", () => {
    const dashboard = nodeOverviewDashboard();
    const key = Object.keys(dashboard.spec.panels)[0]!;
    const next = updatePanel(dashboard, key, statPanel);
    expect(next.spec.panels[key]).toEqual(statPanel);
  });

  it("adds and retitles sections, dropping empty titles", () => {
    let dashboard = addLayout(nodeOverviewDashboard(), "Extra");
    const index = dashboard.spec.layouts.length - 1;
    expect(dashboard.spec.layouts[index]!.spec.display?.title).toBe("Extra");

    dashboard = setLayoutTitle(dashboard, index, "Renamed");
    expect(dashboard.spec.layouts[index]!.spec.display?.title).toBe("Renamed");

    dashboard = setLayoutTitle(dashboard, index, "");
    expect(dashboard.spec.layouts[index]!.spec.display).toBeUndefined();
    expect(() => dashboardSchema.parse(dashboard)).not.toThrow();
  });
});

describe("setVariables", () => {
  const textVariable: Variable = {
    kind: "TextVariable",
    spec: { name: "env", value: "prod" },
  };

  it("replaces the variables list immutably", () => {
    const dashboard = nodeOverviewDashboard();
    const next = setVariables(dashboard, [textVariable]);
    expect(next.spec.variables).toEqual([textVariable]);
    expect(next).not.toBe(dashboard);
  });

  it("removes the field entirely for an empty list", () => {
    const dashboard = setVariables(nodeOverviewDashboard(), [textVariable]);
    const cleared = setVariables(dashboard, []);
    expect("variables" in cleared.spec).toBe(false);
  });
});
