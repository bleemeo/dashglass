import { describe, expect, it } from "vitest";

import { classifyDiffLine } from "./diff";

describe("classifyDiffLine", () => {
  it("separates content changes from file headers", () => {
    expect(classifyDiffLine("+name: new")).toBe("add");
    expect(classifyDiffLine("-name: old")).toBe("del");
    expect(classifyDiffLine("+++ b/dash.yaml")).toBe("meta");
    expect(classifyDiffLine("--- a/dash.yaml")).toBe("meta");
  });

  it("recognizes diff metadata and hunk headers", () => {
    expect(classifyDiffLine("diff --git a/x b/x")).toBe("meta");
    expect(classifyDiffLine("index 84bafc4..a321156 100644")).toBe("meta");
    expect(classifyDiffLine("@@ -17,6 +17,123 @@ spec:")).toBe("hunk");
  });

  it("leaves everything else as context", () => {
    expect(classifyDiffLine(" kind: Dashboard")).toBe("context");
    expect(classifyDiffLine("")).toBe("context");
  });
});
