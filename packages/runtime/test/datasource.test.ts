import { describe, expect, it } from "vitest";

import {
  formatSeriesName,
  interpolate,
  resolveTimeRange,
  stepForRange,
  toTimeSeries,
  type PromResponse,
} from "../src";

describe("resolveTimeRange", () => {
  it("resolves relative ranges against now", () => {
    const now = new Date("2026-07-02T12:00:00Z");
    const resolved = resolveTimeRange({ pastDuration: "1h30m" }, now);
    expect(resolved.end).toEqual(now);
    expect(resolved.start).toEqual(new Date("2026-07-02T10:30:00Z"));
  });

  it("returns absolute ranges unchanged", () => {
    const range = { start: new Date(0), end: new Date(1000) };
    expect(resolveTimeRange(range)).toBe(range);
  });
});

describe("stepForRange", () => {
  const hour = (n: number) => ({
    start: new Date(0),
    end: new Date(n * 3_600_000),
  });

  it("keeps the point count under maxDataPoints with nice steps", () => {
    expect(stepForRange(hour(1))).toBe(15); // 3600/250 = 14.4 → 15
    expect(stepForRange(hour(24))).toBe(600); // 86400/250 = 345.6 → 600
  });

  it("respects the minimum step", () => {
    expect(stepForRange(hour(1), 250, 60)).toBe(60);
  });
});

describe("formatSeriesName", () => {
  const metric = { __name__: "node_load1", instance: "web-1", job: "node" };

  it("applies {{label}} templates", () => {
    expect(formatSeriesName("{{instance}} load", metric)).toBe("web-1 load");
    expect(formatSeriesName("{{ instance }}/{{missing}}", metric)).toBe("web-1/");
  });

  it("defaults to the PromQL-style name", () => {
    expect(formatSeriesName(undefined, metric)).toBe(
      'node_load1{instance="web-1", job="node"}',
    );
    expect(formatSeriesName(undefined, { __name__: "up" })).toBe("up");
  });

  it("falls back to the default name when the template resolves empty", () => {
    expect(formatSeriesName("{{mode}}", metric)).toBe(
      'node_load1{instance="web-1", job="node"}',
    );
    expect(formatSeriesName("  {{mode}} ", { __name__: "up" })).toBe("up");
  });
});

describe("toTimeSeries", () => {
  it("converts a matrix, mapping NaN to null gaps", () => {
    const response: PromResponse = {
      status: "success",
      data: {
        resultType: "matrix",
        result: [
          {
            metric: { __name__: "up", instance: "web-1" },
            values: [
              [100, "1"],
              [115, "NaN"],
              [130, "0.5"],
            ],
          },
        ],
      },
    };
    expect(toTimeSeries(response, "{{instance}}")).toEqual([
      {
        name: "web-1",
        labels: { __name__: "up", instance: "web-1" },
        points: [
          [100_000, 1],
          [115_000, null],
          [130_000, 0.5],
        ],
      },
    ]);
  });

  it("converts a vector to single-point series", () => {
    const response: PromResponse = {
      status: "success",
      data: {
        resultType: "vector",
        result: [{ metric: { __name__: "up" }, value: [100, "1"] }],
      },
    };
    expect(toTimeSeries(response)[0]?.points).toEqual([[100_000, 1]]);
  });
});

describe("interpolate", () => {
  it("substitutes $name and ${name}", () => {
    expect(
      interpolate('up{instance=~"$instance", job="${job}"}', {
        instance: "web-1",
        job: "node",
      }),
    ).toBe('up{instance=~"web-1", job="node"}');
  });

  it("joins multi-values as a regex alternation", () => {
    expect(interpolate("$hosts", { hosts: ["a", "b"] })).toBe("a|b");
  });

  it("leaves unknown variables untouched", () => {
    expect(interpolate("rate($__rate_interval)", {})).toBe(
      "rate($__rate_interval)",
    );
  });
});
