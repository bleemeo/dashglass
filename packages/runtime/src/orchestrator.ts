import type {
  PromResponse,
  PrometheusDataSource,
} from "./datasource";

/**
 * The metrics query engine behind every panel. Self-contained on purpose:
 * no Redux, no TanStack Query in the shared contract (DESIGN.md §8) — host
 * apps keep their own state stack and mount the engine next to it.
 *
 * Responsibilities: share identical queries across panels (one HTTP call,
 * many subscribers), abort abandoned queries, keep recent results briefly
 * so remounts don't refetch.
 */

export interface RangeQuerySpec {
  query: string;
  start: Date;
  end: Date;
  /** Resolution step, in seconds. */
  step: number;
}

export type QueryState =
  | { status: "loading" }
  | { status: "ready"; response: PromResponse }
  | { status: "error"; error: string };

type Listener = (state: QueryState) => void;

interface Entry {
  spec: RangeQuerySpec;
  state: QueryState;
  listeners: Set<Listener>;
  abort: AbortController;
  retireTimer?: ReturnType<typeof setTimeout>;
}

function keyOf(spec: RangeQuerySpec): string {
  return `${spec.query}\n${spec.start.getTime()}\n${spec.end.getTime()}\n${spec.step}`;
}

export interface QueryOrchestratorOptions {
  /** How long a result outlives its last subscriber (ms). */
  retireDelay?: number;
  /** Per-query timeout (ms): a hung backend becomes an actionable error
   * instead of an eternal loading state. */
  queryTimeout?: number;
}

export class QueryOrchestrator {
  private entries = new Map<string, Entry>();
  private retireDelay: number;
  private queryTimeout: number;

  constructor(
    private datasource: PrometheusDataSource,
    options: QueryOrchestratorOptions = {},
  ) {
    this.retireDelay = options.retireDelay ?? 30_000;
    this.queryTimeout = options.queryTimeout ?? 30_000;
  }

  /**
   * Subscribes to a range query, sharing execution with any other
   * subscriber of the same spec. The listener is called synchronously with
   * the current state, then on every change. Returns an unsubscribe
   * function.
   */
  subscribeRangeQuery(spec: RangeQuerySpec, listener: Listener): () => void {
    const key = keyOf(spec);
    let entry = this.entries.get(key);
    if (!entry) {
      entry = {
        spec,
        state: { status: "loading" },
        listeners: new Set(),
        abort: new AbortController(),
      };
      this.entries.set(key, entry);
      this.execute(entry);
    }
    if (entry.retireTimer) {
      clearTimeout(entry.retireTimer);
      entry.retireTimer = undefined;
    }
    entry.listeners.add(listener);
    listener(entry.state);

    return () => {
      entry.listeners.delete(listener);
      if (entry.listeners.size > 0) {
        return;
      }
      if (entry.state.status === "loading") {
        // Nobody is waiting: abort the HTTP call and forget the entry.
        entry.abort.abort();
        this.entries.delete(key);
        return;
      }
      entry.retireTimer = setTimeout(() => {
        this.entries.delete(key);
      }, this.retireDelay);
    };
  }

  private async execute(entry: Entry) {
    const timeout = AbortSignal.timeout(this.queryTimeout);
    let state: QueryState;
    try {
      const response = await this.datasource.rangeQuery({
        ...entry.spec,
        signal: AbortSignal.any([entry.abort.signal, timeout]),
      });
      state =
        response.status === "error"
          ? { status: "error", error: response.error ?? "query failed" }
          : { status: "ready", response };
    } catch (error) {
      if (entry.abort.signal.aborted) {
        return; // Cancelled: the entry is already gone.
      }
      state = timeout.aborted
        ? {
            status: "error",
            error: `query timed out after ${this.queryTimeout / 1000}s`,
          }
        : { status: "error", error: String(error) };
    }
    entry.state = state;
    for (const listener of entry.listeners) {
      listener(state);
    }
  }

  /**
   * Re-executes every settled entry that still has subscribers: the manual
   * refresh for absolute time ranges (their query keys don't change, so
   * re-subscribing alone would just replay the cache) and the retry path
   * for errored panels.
   */
  invalidate(): void {
    for (const entry of this.entries.values()) {
      if (entry.listeners.size === 0 || entry.state.status === "loading") {
        continue;
      }
      entry.state = { status: "loading" };
      for (const listener of entry.listeners) {
        listener(entry.state);
      }
      void this.execute(entry);
    }
  }

  /** Number of live entries — exposed for tests and debugging. */
  size(): number {
    return this.entries.size;
  }
}
