import { describe, expect, it } from "vitest";

import { createRegistries } from "../src";

describe("registries", () => {
  it("rejects duplicate kinds", () => {
    const { panels } = createRegistries();
    const plugin = { kind: "TimeSeriesChart", component: () => null };
    panels.register(plugin);
    expect(() => panels.register(plugin)).toThrow(/already registered/);
  });

  it("returns undefined for unknown kinds", () => {
    const { panels } = createRegistries();
    expect(panels.get("Nope")).toBeUndefined();
  });

  it("sorts navigation pages by order", () => {
    const { pages } = createRegistries();
    pages.register({ kind: "settings", path: "/settings", element: null });
    pages.register({
      kind: "explore",
      path: "/explore",
      element: null,
      nav: { title: "Explore", order: 2 },
    });
    pages.register({
      kind: "dashboards",
      path: "/",
      element: null,
      nav: { title: "Dashboards", order: 1 },
    });
    expect(pages.navPages().map((page) => page.kind)).toEqual([
      "dashboards",
      "explore",
    ]);
  });
});
