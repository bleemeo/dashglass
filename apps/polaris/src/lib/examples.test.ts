import { describe, expect, it } from "vitest";

import { DASHBOARD_EXAMPLES } from "./examples";

describe("DASHBOARD_EXAMPLES", () => {
  it("has unique keys", () => {
    const keys = DASHBOARD_EXAMPLES.map((example) => example.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  // build() runs dashboardSchema.parse, so a malformed example throws here
  // rather than when a user clicks it from the empty state.
  it.each(DASHBOARD_EXAMPLES.map((example) => [example.key, example] as const))(
    "%s builds into a valid dashboard",
    (key, example) => {
      const dashboard = example.build();
      expect(dashboard.metadata.name).toBe(key);
      expect(Object.keys(dashboard.spec.panels).length).toBeGreaterThan(0);
      expect(dashboard.spec.layouts.length).toBeGreaterThan(0);
    },
  );
});
