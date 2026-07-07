import { describe, expect, it } from "vitest";

import { interpolate } from "../src";

describe("interpolate", () => {
  it("substitutes $name and ${name}", () => {
    expect(interpolate("up{job=\"$job\"}", { job: "node" })).toBe(
      'up{job="node"}',
    );
    expect(interpolate("up{job=\"${job}\"}", { job: "node" })).toBe(
      'up{job="node"}',
    );
  });

  it("leaves unknown variables untouched", () => {
    expect(interpolate("$missing", {})).toBe("$missing");
  });

  it("renders a single value verbatim (usable in an exact matcher)", () => {
    expect(interpolate("$instance", { instance: "host.a:9100" })).toBe(
      "host.a:9100",
    );
  });

  it("joins multi-values as a regex alternation, double-escaped for the PromQL string layer", () => {
    // Each "." becomes "\\." so the quoted-string decode leaves "\." for RE2.
    expect(
      interpolate("$instance", { instance: ["host.a", "10.0.0.1:9100"] }),
    ).toBe("host\\\\.a|10\\\\.0\\\\.0\\\\.1:9100");
  });

  it("escapes alternation characters inside a member", () => {
    expect(interpolate("$x", { x: ["a|b", "c"] })).toBe("a\\\\|b|c");
  });
});
