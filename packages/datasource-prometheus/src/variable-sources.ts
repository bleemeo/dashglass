import type {
  VariableSourcePlugin,
  VariableSourceRegistry,
} from "@dashglass/runtime";

/**
 * Feeds ListVariables from Prometheus label values — the model's
 * `PrometheusLabelValuesVariable` plugin kind:
 *
 *   plugin:
 *     kind: PrometheusLabelValuesVariable
 *     spec:
 *       labelName: instance
 *       matchers: ['up{job="node"}']   # optional
 */
export const labelValuesVariableSource: VariableSourcePlugin = {
  kind: "PrometheusLabelValuesVariable",
  async loadValues(spec, context) {
    const labelName = spec["labelName"];
    if (typeof labelName !== "string" || labelName === "") {
      return [];
    }
    const matchers = Array.isArray(spec["matchers"])
      ? spec["matchers"].filter((m): m is string => typeof m === "string")
      : [];
    return context.datasource.labelValues(labelName, {
      match: matchers.length > 0 ? matchers : undefined,
      start: context.timeRange.start,
      end: context.timeRange.end,
    });
  },
};

/** Registers every Prometheus-backed variable source. */
export function registerPrometheusVariableSources(
  registry: VariableSourceRegistry,
): void {
  registry.register(labelValuesVariableSource);
}
