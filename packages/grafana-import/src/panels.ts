import type { GrafanaPanel } from "./types";
import { mapUnit } from "./units";

/**
 * Per-panel-type spec migrations. Colocating one entry per target kind
 * mirrors the Perses approach (each plugin owns its Grafana translation);
 * hosts can pass extra migrations for proprietary kinds.
 */
export interface PanelMigration {
  /** Grafana panel `type` values handled by this entry. */
  types: string[];
  /** Dashglass panel plugin kind produced. */
  kind: string;
  /** Builds the plugin spec; returns only non-default keys. */
  migrateSpec: (
    panel: GrafanaPanel,
    warn: (message: string) => void,
  ) => Record<string, unknown>;
}

type Warn = (message: string) => void;

function defaults(panel: GrafanaPanel) {
  return panel.fieldConfig?.defaults ?? {};
}

function set(
  spec: Record<string, unknown>,
  key: string,
  value: unknown,
): void {
  if (value !== undefined && value !== false && value !== "") {
    spec[key] = value;
  }
}

/** Grafana reducer/calc id → Dashglass calculation (last is the default). */
function mapCalculation(calc: string | undefined): string | undefined {
  switch (calc) {
    case "mean":
      return "mean";
    case "min":
      return "min";
    case "max":
      return "max";
    case "sum":
    case "total":
      return "sum";
    default:
      return undefined; // last / lastNotNull / current → our default
  }
}

function firstCalc(panel: GrafanaPanel): string | undefined {
  const options = panel.options as
    | { reduceOptions?: { calcs?: string[] } }
    | undefined;
  return options?.reduceOptions?.calcs?.[0];
}

function migrateTimeSeries(panel: GrafanaPanel, warn: Warn) {
  const spec: Record<string, unknown> = {};
  const field = defaults(panel);
  const title = panel.title ?? "panel";

  if (panel.type === "graph") {
    // Legacy flat fields.
    const yaxes = panel["yaxes"] as { format?: string }[] | undefined;
    set(spec, "unit", mapUnit(yaxes?.[0]?.format, warn, title));
    set(spec, "stack", panel["stack"] === true);
    set(spec, "area", typeof panel["fill"] === "number" && panel["fill"] > 0);
    const legend = panel["legend"] as { show?: boolean } | undefined;
    if (legend?.show === false) {
      spec["legend"] = { position: "hidden" };
    }
  } else {
    set(spec, "unit", mapUnit(field.unit, warn, title));
    set(spec, "min", field.min);
    set(spec, "max", field.max);
    set(spec, "stack", field.custom?.stacking?.mode === "normal");
    set(spec, "area", (field.custom?.fillOpacity ?? 0) > 0);
    const legend = panel.options?.["legend"] as
      | { showLegend?: boolean; displayMode?: string; placement?: string }
      | undefined;
    if (legend?.showLegend === false || legend?.displayMode === "hidden") {
      spec["legend"] = { position: "hidden" };
    } else if (legend?.placement === "right") {
      spec["legend"] = { position: "right" };
    }
  }
  return spec;
}

function migrateStat(panel: GrafanaPanel, warn: Warn) {
  const spec: Record<string, unknown> = {};
  const title = panel.title ?? "panel";

  if (panel.type === "singlestat") {
    // Legacy flat fields.
    set(spec, "unit", mapUnit(panel["format"] as string, warn, title));
    set(spec, "decimals", panel["decimals"]);
    const valueName = panel["valueName"] as string | undefined;
    set(
      spec,
      "calculation",
      mapCalculation(valueName === "avg" ? "mean" : valueName),
    );
    const sparkline = panel["sparkline"] as { show?: boolean } | undefined;
    set(spec, "sparkline", sparkline?.show === true);
  } else {
    const field = defaults(panel);
    set(spec, "unit", mapUnit(field.unit, warn, title));
    set(spec, "decimals", field.decimals);
    set(spec, "calculation", mapCalculation(firstCalc(panel)));
    set(spec, "sparkline", panel.options?.["graphMode"] === "area");
  }
  return spec;
}

/** Threshold step color → status, by name then by position. */
function mapThresholdStatus(
  color: string | undefined,
  index: number,
  count: number,
): "warning" | "serious" | "critical" {
  const normalized = (color ?? "").toLowerCase();
  if (normalized.includes("red")) {
    return "critical";
  }
  if (normalized.includes("orange")) {
    return "serious";
  }
  if (normalized.includes("yellow") || normalized === "#eab839") {
    return "warning";
  }
  return index === count - 1 ? "critical" : "warning";
}

function migrateGauge(panel: GrafanaPanel, warn: Warn) {
  const spec: Record<string, unknown> = {};
  const field = defaults(panel);
  set(spec, "unit", mapUnit(field.unit, warn, panel.title ?? "panel"));
  set(spec, "min", field.min);
  set(spec, "max", field.max);

  const steps = (field.thresholds?.steps ?? []).filter(
    (step): step is { color?: string; value: number } =>
      typeof step.value === "number",
  );
  if (steps.length > 0) {
    spec["thresholds"] = steps.map((step, index) => ({
      value: step.value,
      status: mapThresholdStatus(step.color, index, steps.length),
    }));
  }
  return spec;
}

function migrateBar(panel: GrafanaPanel, warn: Warn) {
  const spec: Record<string, unknown> = {};
  const field = defaults(panel);
  set(spec, "unit", mapUnit(field.unit, warn, panel.title ?? "panel"));
  set(spec, "calculation", mapCalculation(firstCalc(panel)));
  if (panel.options?.["orientation"] === "vertical") {
    spec["orientation"] = "vertical";
  }
  return spec;
}

export const BUILTIN_MIGRATIONS: PanelMigration[] = [
  {
    types: ["timeseries", "graph"],
    kind: "TimeSeriesChart",
    migrateSpec: migrateTimeSeries,
  },
  { types: ["stat", "singlestat"], kind: "StatChart", migrateSpec: migrateStat },
  { types: ["gauge"], kind: "GaugeChart", migrateSpec: migrateGauge },
  {
    types: ["table", "table-old"],
    kind: "Table",
    migrateSpec: (panel, warn) => {
      const spec: Record<string, unknown> = {};
      set(
        spec,
        "unit",
        mapUnit(defaults(panel).unit, warn, panel.title ?? "panel"),
      );
      return spec;
    },
  },
  {
    types: ["bargauge", "barchart"],
    kind: "BarChart",
    migrateSpec: migrateBar,
  },
  {
    types: ["heatmap"],
    kind: "HeatmapChart",
    migrateSpec: (panel, warn) => {
      const spec: Record<string, unknown> = {};
      set(
        spec,
        "unit",
        mapUnit(defaults(panel).unit, warn, panel.title ?? "panel"),
      );
      return spec;
    },
  },
  {
    types: ["text"],
    kind: "Markdown",
    migrateSpec: (panel) => {
      const spec: Record<string, unknown> = {};
      // v7+: options.content; legacy: flat content field.
      const content = panel.options?.["content"] ?? panel["content"];
      set(spec, "content", typeof content === "string" ? content : undefined);
      return spec;
    },
  },
];
