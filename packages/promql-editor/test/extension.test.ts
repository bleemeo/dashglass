import { describe, expect, it } from "vitest";

import { buildPromQLExtension } from "../src";

describe("buildPromQLExtension", () => {
  it("builds a CodeMirror extension without a remote endpoint", () => {
    expect(buildPromQLExtension()).toBeDefined();
  });

  it("builds a CodeMirror extension with remote completion", () => {
    const fetchFn: typeof fetch = async () =>
      new Response(JSON.stringify({ status: "success", data: [] }));
    expect(
      buildPromQLExtension({ completeURL: "http://backend", fetchFn }),
    ).toBeDefined();
  });
});
