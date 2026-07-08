import { describe, expect, it } from "vitest";

import type { AuthProvider } from "@dashglass/runtime";

import { HTTPPrometheusDataSource, labelValuesVariableSource } from "../src";

interface SeenRequest {
  url: string;
  init: RequestInit | undefined;
}

function fakeFetch(body: unknown, seen: SeenRequest[]): typeof fetch {
  return async (input, init) => {
    seen.push({ url: String(input), init });
    return new Response(JSON.stringify(body), {
      headers: { "Content-Type": "application/json" },
    });
  };
}

describe("HTTPPrometheusDataSource", () => {
  it("POSTs range queries as form data to the native path", async () => {
    const seen: SeenRequest[] = [];
    const datasource = new HTTPPrometheusDataSource({
      baseURL: "http://backend/",
      fetchFn: fakeFetch({ status: "success" }, seen),
    });

    await datasource.rangeQuery({
      query: "up",
      start: new Date(1_000),
      end: new Date(61_000),
      step: 15,
    });

    expect(seen[0]?.url).toBe("http://backend/api/v1/query_range");
    expect(seen[0]?.init?.method).toBe("POST");
    const form = new URLSearchParams(String(seen[0]?.init?.body));
    expect(form.get("query")).toBe("up");
    expect(form.get("start")).toBe("1");
    expect(form.get("end")).toBe("61");
    expect(form.get("step")).toBe("15");
  });

  it("fetches label values with matchers, URL-encoding the label", async () => {
    const seen: SeenRequest[] = [];
    const datasource = new HTTPPrometheusDataSource({
      baseURL: "http://backend",
      fetchFn: fakeFetch({ status: "success", data: ["web-1", "web-2"] }, seen),
    });

    const values = await datasource.labelValues("instance", {
      match: ['up{job="node"}'],
    });

    expect(values).toEqual(["web-1", "web-2"]);
    const url = new URL(seen[0]!.url);
    expect(url.pathname).toBe("/api/v1/label/instance/values");
    expect(url.searchParams.get("match[]")).toBe('up{job="node"}');
  });

  it("decorates requests through the auth provider", async () => {
    const seen: SeenRequest[] = [];
    const auth: AuthProvider = {
      kind: "test",
      getUser: async () => null,
      decorateRequest: (init) => ({
        ...init,
        headers: { ...init.headers, "X-Test-Auth": "token" },
      }),
    };
    const datasource = new HTTPPrometheusDataSource({
      baseURL: "",
      auth,
      fetchFn: fakeFetch({ status: "success" }, seen),
    });

    await datasource.instantQuery({ query: "up" });
    expect(
      (seen[0]?.init?.headers as Record<string, string>)["X-Test-Auth"],
    ).toBe("token");
  });

  it("surfaces Prometheus error envelopes on label queries", async () => {
    const datasource = new HTTPPrometheusDataSource({
      baseURL: "",
      fetchFn: fakeFetch({ status: "error", error: "boom" }, []),
    });
    await expect(datasource.labelNames()).rejects.toThrow("boom");
  });
});

describe("labelValuesVariableSource", () => {
  it("loads values through the datasource with the time range", async () => {
    const calls: unknown[] = [];
    const values = await labelValuesVariableSource.loadValues(
      { labelName: "instance", matchers: ["up"] },
      {
        datasource: {
          rangeQuery: async () => ({ status: "success" as const }),
          instantQuery: async () => ({ status: "success" as const }),
          labelNames: async () => [],
          labelValues: async (label, params) => {
            calls.push([label, params?.match]);
            return ["web-1"];
          },
        },
        timeRange: { start: new Date(0), end: new Date(1000) },
      },
    );
    expect(values).toEqual(["web-1"]);
    expect(calls).toEqual([["instance", ["up"]]]);
  });

  it("returns no values without a labelName", async () => {
    const values = await labelValuesVariableSource.loadValues(
      {},
      {
        datasource: {
          rangeQuery: async () => ({ status: "success" as const }),
          instantQuery: async () => ({ status: "success" as const }),
          labelNames: async () => [],
          labelValues: async () => ["nope"],
        },
        timeRange: { start: new Date(0), end: new Date(1000) },
      },
    );
    expect(values).toEqual([]);
  });
});
