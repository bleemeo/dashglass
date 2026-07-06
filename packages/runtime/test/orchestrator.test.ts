import { describe, expect, it, vi } from "vitest";

import type {
  PromResponse,
  PrometheusDataSource,
  RangeQueryParams,
} from "../src";
import { QueryOrchestrator, type QueryState } from "../src";

const success: PromResponse = {
  status: "success",
  data: { resultType: "matrix", result: [] },
};

function fakeDatasource(
  rangeQuery: (params: RangeQueryParams) => Promise<PromResponse>,
): PrometheusDataSource {
  return {
    rangeQuery,
    instantQuery: vi.fn(),
    labelNames: vi.fn(),
    labelValues: vi.fn(),
  };
}

const spec = {
  query: "up",
  start: new Date(1000),
  end: new Date(2000),
  step: 15,
};

describe("QueryOrchestrator", () => {
  it("shares one HTTP call between identical subscriptions", async () => {
    let calls = 0;
    let release!: (response: PromResponse) => void;
    const orchestrator = new QueryOrchestrator(
      fakeDatasource(() => {
        calls += 1;
        return new Promise((resolve) => {
          release = resolve;
        });
      }),
    );

    const statesA: QueryState[] = [];
    const statesB: QueryState[] = [];
    orchestrator.subscribeRangeQuery(spec, (state) => statesA.push(state));
    orchestrator.subscribeRangeQuery({ ...spec }, (state) => statesB.push(state));

    expect(calls).toBe(1);
    release(success);
    await vi.waitFor(() => {
      expect(statesA.at(-1)).toEqual({ status: "ready", response: success });
      expect(statesB.at(-1)).toEqual({ status: "ready", response: success });
    });
  });

  it("runs different specs separately", () => {
    let calls = 0;
    const orchestrator = new QueryOrchestrator(
      fakeDatasource(async () => {
        calls += 1;
        return success;
      }),
    );
    orchestrator.subscribeRangeQuery(spec, () => {});
    orchestrator.subscribeRangeQuery({ ...spec, query: "up == 1" }, () => {});
    expect(calls).toBe(2);
  });

  it("aborts the HTTP call when the last waiting subscriber leaves", async () => {
    let signal: AbortSignal | undefined;
    const orchestrator = new QueryOrchestrator(
      fakeDatasource(
        (params) =>
          new Promise((_, reject) => {
            signal = params.signal;
            params.signal?.addEventListener("abort", () =>
              reject(new DOMException("aborted", "AbortError")),
            );
          }),
      ),
    );

    const unsubscribe = orchestrator.subscribeRangeQuery(spec, () => {});
    expect(signal?.aborted).toBe(false);
    unsubscribe();
    expect(signal?.aborted).toBe(true);
    expect(orchestrator.size()).toBe(0);
  });

  it("reports query errors from the response envelope", async () => {
    const orchestrator = new QueryOrchestrator(
      fakeDatasource(async () => ({
        status: "error",
        errorType: "bad_data",
        error: "parse error",
      })),
    );
    const states: QueryState[] = [];
    orchestrator.subscribeRangeQuery(spec, (state) => states.push(state));
    await vi.waitFor(() => {
      expect(states.at(-1)).toEqual({ status: "error", error: "parse error" });
    });
  });

  it("invalidate re-executes settled entries with subscribers", async () => {
    let calls = 0;
    const orchestrator = new QueryOrchestrator(
      fakeDatasource(async () => {
        calls += 1;
        // First call fails, the retry succeeds.
        return calls === 1
          ? { status: "error", errorType: "timeout", error: "boom" }
          : success;
      }),
    );
    const states: QueryState[] = [];
    orchestrator.subscribeRangeQuery(spec, (state) => states.push(state));
    await vi.waitFor(() => {
      expect(states.at(-1)).toEqual({ status: "error", error: "boom" });
    });

    orchestrator.invalidate();
    expect(states.at(-1)).toEqual({ status: "loading" });
    await vi.waitFor(() => {
      expect(states.at(-1)).toEqual({ status: "ready", response: success });
    });
    expect(calls).toBe(2);
  });

  it("invalidate skips entries without subscribers", async () => {
    let calls = 0;
    const orchestrator = new QueryOrchestrator(
      fakeDatasource(async () => {
        calls += 1;
        return success;
      }),
      { retireDelay: 60_000 },
    );
    const unsubscribe = orchestrator.subscribeRangeQuery(spec, () => {});
    await vi.waitFor(() => expect(calls).toBe(1));
    unsubscribe();

    orchestrator.invalidate();
    expect(calls).toBe(1);
  });

  it("turns a hung request into a timeout error", async () => {
    const orchestrator = new QueryOrchestrator(
      fakeDatasource(
        (params) =>
          new Promise((_, reject) => {
            params.signal?.addEventListener("abort", () =>
              reject(new DOMException("aborted", "TimeoutError")),
            );
          }),
      ),
      { queryTimeout: 20 },
    );
    const states: QueryState[] = [];
    orchestrator.subscribeRangeQuery(spec, (state) => states.push(state));
    await vi.waitFor(() => {
      expect(states.at(-1)).toEqual({
        status: "error",
        error: "query timed out after 0.02s",
      });
    });
  });

  it("keeps completed results for late subscribers, then retires them", async () => {
    vi.useFakeTimers();
    try {
      let calls = 0;
      const orchestrator = new QueryOrchestrator(
        fakeDatasource(async () => {
          calls += 1;
          return success;
        }),
        { retireDelay: 1000 },
      );

      const unsubscribe = orchestrator.subscribeRangeQuery(spec, () => {});
      await vi.advanceTimersByTimeAsync(0); // let the fetch settle
      unsubscribe();

      // Within the retirement window: served from cache.
      const states: QueryState[] = [];
      orchestrator.subscribeRangeQuery(spec, (s) => states.push(s))();
      expect(calls).toBe(1);
      expect(states[0]?.status).toBe("ready");

      // After the window: re-fetched.
      await vi.advanceTimersByTimeAsync(1500);
      orchestrator.subscribeRangeQuery(spec, () => {});
      expect(calls).toBe(2);
    } finally {
      vi.useRealTimers();
    }
  });
});
