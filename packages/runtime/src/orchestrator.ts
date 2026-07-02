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
}

export class QueryOrchestrator {
  private entries = new Map<string, Entry>();
  private retireDelay: number;

  constructor(
    private datasource: PrometheusDataSource,
    options: QueryOrchestratorOptions = {},
  ) {
    this.retireDelay = options.retireDelay ?? 30_000;
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
        state: { status: "loading" },
        listeners: new Set(),
        abort: new AbortController(),
      };
      this.entries.set(key, entry);
      this.execute(key, spec, entry);
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

  private async execute(key: string, spec: RangeQuerySpec, entry: Entry) {
    let state: QueryState;
    try {
      const response = await this.datasource.rangeQuery({
        ...spec,
        signal: entry.abort.signal,
      });
      state =
        response.status === "error"
          ? { status: "error", error: response.error ?? "query failed" }
          : { status: "ready", response };
    } catch (error) {
      if (entry.abort.signal.aborted) {
        return; // Cancelled: the entry is already gone.
      }
      state = { status: "error", error: String(error) };
    }
    entry.state = state;
    for (const listener of entry.listeners) {
      listener(state);
    }
  }

  /** Number of live entries — exposed for tests and debugging. */
  size(): number {
    return this.entries.size;
  }
}
