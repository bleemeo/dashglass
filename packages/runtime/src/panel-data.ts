import { useEffect, useMemo, useState } from "react";

import type { Panel } from "@polarisui/model";

import { useRuntime, useTimeRange, useVariables } from "./context";
import { stepForRange, toTimeSeries } from "./datasource";
import { interpolate, type VariableValues } from "./interpolate";
import type { QueryState, RangeQuerySpec } from "./orchestrator";
import type { PanelData } from "./registries";

/**
 * The query kind the runtime executes natively. Polaris is
 * Prometheus-native by design; if a second query family ever appears this
 * becomes a query-plugin registry.
 */
export const PROMETHEUS_QUERY_KIND = "PrometheusTimeSeriesQuery";

interface PreparedQuery {
  spec: RangeQuerySpec;
  seriesNameFormat: string | undefined;
}

function prepareQueries(
  panel: Panel,
  values: VariableValues,
  range: { start: Date; end: Date },
): PreparedQuery[] {
  const prepared: PreparedQuery[] = [];
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
    prepared.push({
      spec: {
        query: interpolate(promql, values),
        start: range.start,
        end: range.end,
        step: stepForRange(
          range,
          undefined,
          typeof minStep === "number" ? minStep : undefined,
        ),
      },
      seriesNameFormat:
        typeof plugin.spec?.["seriesNameFormat"] === "string"
          ? plugin.spec["seriesNameFormat"]
          : undefined,
    });
  }
  return prepared;
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

  return useMemo<PanelData>(() => {
    if (variablesLoading || states.some((state) => state.status === "loading")) {
      return { state: "loading", series: [], errors: [] };
    }
    const series = states.flatMap((state, index) =>
      state.status === "ready"
        ? toTimeSeries(state.response, queries[index]?.seriesNameFormat)
        : [],
    );
    const errors = states.flatMap((state) =>
      state.status === "error" ? [state.error] : [],
    );
    return {
      state: errors.length > 0 ? "error" : "ready",
      series,
      errors,
    };
  }, [states, queries, variablesLoading]);
}
