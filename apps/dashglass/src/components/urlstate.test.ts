import { describe, expect, it } from "vitest";

import { parseGrafanaComID } from "./NewDashboardDialog";
import {
  exploreHref,
  rangeFromParams,
  variablesFromParams,
} from "./URLStateSync";

describe("rangeFromParams", () => {
  it("parses a relative range", () => {
    const range = rangeFromParams(new URLSearchParams("from=now-6h"));
    expect(range).toEqual({ pastDuration: "6h" });
  });

  it("parses an absolute range from millisecond bounds", () => {
    const range = rangeFromParams(
      new URLSearchParams("from=1000&to=5000"),
    );
    expect(range && "start" in range).toBe(true);
    if (range && "start" in range) {
      expect(range.start.getTime()).toBe(1000);
      expect(range.end.getTime()).toBe(5000);
    }
  });

  it("rejects incomplete or inverted absolute ranges", () => {
    expect(rangeFromParams(new URLSearchParams(""))).toBeNull();
    expect(rangeFromParams(new URLSearchParams("from=5000&to=1000"))).toBeNull();
    expect(rangeFromParams(new URLSearchParams("from=abc"))).toBeNull();
  });
});

describe("variablesFromParams", () => {
  it("reads var- params, single and multi-value", () => {
    const values = variablesFromParams(
      new URLSearchParams("var-instance=web-1&var-job=a&var-job=b&other=x"),
    );
    expect(values).toEqual({ instance: "web-1", job: ["a", "b"] });
  });

  it("ignores non-var params", () => {
    expect(variablesFromParams(new URLSearchParams("from=now-1h"))).toEqual({});
  });
});

describe("exploreHref", () => {
  it("carries the expression and a relative range", () => {
    expect(exploreHref('up{job="a"}', { pastDuration: "6h" })).toBe(
      "/explore?expr=up%7Bjob%3D%22a%22%7D&from=now-6h",
    );
  });

  it("carries an absolute range as millisecond bounds", () => {
    expect(
      exploreHref("up", { start: new Date(1000), end: new Date(5000) }),
    ).toBe("/explore?expr=up&from=1000&to=5000");
  });
});

describe("parseGrafanaComID", () => {
  it("accepts a bare numeric id", () => {
    expect(parseGrafanaComID("1860")).toBe("1860");
    expect(parseGrafanaComID("  1860 ")).toBe("1860");
  });

  it("extracts the id from marketplace URLs", () => {
    expect(
      parseGrafanaComID("https://grafana.com/grafana/dashboards/1860-node-exporter-full/"),
    ).toBe("1860");
    expect(parseGrafanaComID("grafana.com/dashboards/315")).toBe("315");
  });

  it("rejects non-dashboard input", () => {
    expect(parseGrafanaComID("node exporter")).toBeNull();
    expect(parseGrafanaComID("https://example.com/x/1860")).toBeNull();
  });
});
