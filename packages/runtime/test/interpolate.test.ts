import { describe, expect, it } from "vitest";

import { interpolate, interpolateUrl } from "../src";

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

describe("interpolateUrl", () => {
  it("percent-encodes single values so they are query-string safe", () => {
    expect(
      interpolateUrl("/d/host?var-instance=$instance", {
        instance: "host a:9100",
      }),
    ).toBe("/d/host?var-instance=host%20a%3A9100");
  });

  it("joins multi-values with commas, each percent-encoded", () => {
    expect(interpolateUrl("?v=$x", { x: ["a b", "c/d"] })).toBe(
      "?v=a%20b,c%2Fd",
    );
  });

  it("substitutes the $__from / $__to time-range tokens", () => {
    expect(
      interpolateUrl("?from=$__from&to=$__to", {
        __from: "1000",
        __to: "2000",
      }),
    ).toBe("?from=1000&to=2000");
  });

  it("leaves unknown variables untouched", () => {
    expect(interpolateUrl("$missing", {})).toBe("$missing");
  });
});
