import { useEffect, useMemo, useRef, useState } from "react";

import type { Panel } from "@dashglass/model";

import { useRuntime, useTimeRange, useVariables } from "./context";
import { stepForRange, toTimeSeries, type TimeSeries } from "./datasource";
import { interpolate, type VariableValues } from "./interpolate";
import type { QueryState, RangeQuerySpec } from "./orchestrator";
import type { PanelData } from "./registries";

/**
 * The query kind the runtime executes natively. Dashglass is
 * Prometheus-native by design; if a second query family ever appears this
 * becomes a query-plugin registry.
 */
export const PROMETHEUS_QUERY_KIND = "PrometheusTimeSeriesQuery";

interface PreparedQuery {
  spec: RangeQuerySpec;
  seriesNameFormat: string | undefined;
}

interface PromQuery {
  promql: string;
  minStep: number | undefined;
  seriesNameFormat: string | undefined;
}

/**
 * The panel's runnable Prometheus queries, in spec order: other query
 * kinds and empty expressions are skipped, exactly as the orchestrator
 * path does. Expressions are raw — variables are not interpolated yet.
 */
function promQueries(panel: Panel): PromQuery[] {
  const queries: PromQuery[] = [];
  for (const query of panel.spec.queries ?? []) {
    const plugin = query.spec.plugin;
    if (plugin.kind !== PROMETHEUS_QUERY_KIND) {
      continue;
    }
    const promql = plugin.spec?.["query"];
    if (typeof promql !== "string" || promql === "") {
      continue;
    }
    const minStep = plugin.spec?.["minStep"];
    queries.push({
      promql,
      minStep: typeof minStep === "number" ? minStep : undefined,
      seriesNameFormat:
        typeof plugin.spec?.["seriesNameFormat"] === "string"
          ? plugin.spec["seriesNameFormat"]
          : undefined,
    });
  }
  return queries;
}

/**
 * A panel's PromQL expressions with the current variable values applied —
 * what the panel is really asking Prometheus. Hosts use it for actions
 * that hand a query to another surface (open it in Explore, copy it);
 * pass the panel-scoped values (`useVariables()`) so a repeated panel
 * yields its own instance's expressions.
 */
export function panelPromQL(panel: Panel, values: VariableValues): string[] {
  return promQueries(panel).map((query) => interpolate(query.promql, values));
}

function prepareQueries(
  panel: Panel,
  values: VariableValues,
  range: { start: Date; end: Date },
): PreparedQuery[] {
  return promQueries(panel).map((query) => ({
    spec: {
      query: interpolate(query.promql, values),
      start: range.start,
      end: range.end,
      step: stepForRange(range, undefined, query.minStep),
    },
    seriesNameFormat: query.seriesNameFormat,
  }));
}

/**
 * Runs a panel's queries through the orchestrator and aggregates the
 * results into the PanelData handed to the panel plugin component.
 */
export function usePanelData(panel: Panel): PanelData {
  const { orchestrator } = useRuntime();
  const { resolved } = useTimeRange();
  const { values, loading: variablesLoading } = useVariables();

  const queries = useMemo(
    () => prepareQueries(panel, values, resolved),
    [panel, values, resolved],
  );
  const [states, setStates] = useState<QueryState[]>([]);

  // Re-subscribing is cheap (the orchestrator dedupes identical specs), so
  // the effect simply keys on the prepared queries.
  const subscriptionKey = JSON.stringify(queries);
  useEffect(() => {
    if (variablesLoading) {
      return;
    }
    const current: QueryState[] = queries.map(() => ({ status: "loading" }));
    setStates([...current]);
    const unsubscribes = queries.map((query, index) =>
      orchestrator.subscribeRangeQuery(query.spec, (state) => {
        current[index] = state;
        setStates([...current]);
      }),
    );
    return () => {
      for (const unsubscribe of unsubscribes) {
        unsubscribe();
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- queries is captured by subscriptionKey
  }, [orchestrator, subscriptionKey, variablesLoading]);

  // Last complete result: shown while a refresh or range change reloads,
  // so charts update in place instead of flashing empty.
  const lastReady = useRef<TimeSeries[] | null>(null);

  return useMemo<PanelData>(() => {
    if (variablesLoading || states.some((state) => state.status === "loading")) {
      return {
        state: "loading",
        series: lastReady.current ?? [],
        errors: [],
      };
    }
    const series = states.flatMap((state, index) =>
      state.status === "ready"
        ? toTimeSeries(state.response, queries[index]?.seriesNameFormat)
        : [],
    );
    const errors = states.flatMap((state) =>
      state.status === "error" ? [state.error] : [],
    );
    if (errors.length === 0) {
      lastReady.current = series;
    }
    return {
      state: errors.length > 0 ? "error" : "ready",
      series,
      errors,
    };
  }, [states, queries, variablesLoading]);
}
