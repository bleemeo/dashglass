import {
  dashboardSchema,
  panelRefFromKey,
  type Dashboard,
  type GridItem,
  type GridLayout,
  type Panel,
  type Query,
  type Variable,
} from "@dashglass/model";

import { BUILTIN_MIGRATIONS, type PanelMigration } from "./panels";
import type { GrafanaDashboard, GrafanaPanel, GrafanaTarget } from "./types";
import { migrateVariables } from "./variables";

export interface GrafanaImportOptions {
  /** Extra panel migrations (e.g. proprietary kinds), tried first. */
  migrations?: PanelMigration[];
}

export interface GrafanaImportResult {
  dashboard: Dashboard;
  /** Best-effort log: everything that was dropped or approximated. */
  warnings: string[];
}

function slugify(text: string, fallback: string): string {
  const slug = text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return slug === "" ? fallback : slug;
}

/**
 * Rewrites Grafana templating syntax to the Dashglass interpolation forms:
 * `[[var]]` → `$var`, `${var:format}` → `${var}`, and the built-in interval
 * variables to a fixed window (Dashglass computes its own step).
 */
export function rewriteExpression(expression: string): string {
  return expression
    .replace(/\[\[([a-zA-Z_][a-zA-Z0-9_]*)\]\]/g, "$$$1")
    .replace(/\$\{([a-zA-Z_][a-zA-Z0-9_]*):[a-zA-Z]+\}/g, "${$1}")
    .replace(/\$__rate_interval\b|\$\{__rate_interval\}/g, "5m")
    .replace(/\$__interval\b|\$\{__interval\}/g, "5m");
}

function migrateQueries(
  panel: GrafanaPanel,
  warn: (message: string) => void,
): Query[] {
  const queries: Query[] = [];
  for (const target of panel.targets ?? []) {
    if (target.hide === true) {
      continue;
    }
    const expr = (target as GrafanaTarget).expr;
    if (typeof expr !== "string" || expr.trim() === "") {
      continue;
    }
    const spec: Record<string, unknown> = {
      query: rewriteExpression(expr),
    };
    if (
      typeof target.legendFormat === "string" &&
      target.legendFormat !== "" &&
      target.legendFormat !== "__auto"
    ) {
      spec["seriesNameFormat"] = target.legendFormat;
    }
    queries.push({
      kind: "TimeSeriesQuery",
      spec: { plugin: { kind: "PrometheusTimeSeriesQuery", spec } },
    });
  }
  if (queries.length === 0 && (panel.targets?.length ?? 0) > 0) {
    warn(
      `panel "${panel.title ?? "?"}": no convertible query (non-PromQL targets?)`,
    );
  }
  return queries;
}

interface Section {
  title?: string;
  panels: { key: string; grafana: GrafanaPanel }[];
}

/** Splits the flat panel list into sections at `row` panels. */
function splitSections(
  panels: GrafanaPanel[],
  reserveKey: (title: string) => string,
): Section[] {
  const sections: Section[] = [{ panels: [] }];
  const append = (section: Section, panel: GrafanaPanel) => {
    section.panels.push({
      key: reserveKey(panel.title ?? panel.type ?? "panel"),
      grafana: panel,
    });
  };

  for (const panel of panels) {
    if (panel.type === "row") {
      const section: Section = {
        ...(panel.title ? { title: panel.title } : {}),
        panels: [],
      };
      sections.push(section);
      // A collapsed row nests its panels instead of listing them flat.
      for (const nested of panel.panels ?? []) {
        append(section, nested);
      }
    } else {
      append(sections[sections.length - 1]!, panel);
    }
  }
  return sections.filter(
    (section) => section.panels.length > 0 || section.title,
  );
}

function toGridItem(panel: GrafanaPanel, key: string, yOffset: number): GridItem {
  const pos = panel.gridPos ?? {};
  const x = Math.min(Math.max(pos.x ?? 0, 0), 23);
  return {
    x,
    y: Math.max((pos.y ?? 0) - yOffset, 0),
    width: Math.min(Math.max(pos.w ?? 12, 1), 24 - x),
    height: Math.max(pos.h ?? 8, 1),
    content: { $ref: panelRefFromKey(key) },
  };
}

/**
 * Converts a Grafana dashboard JSON document to a Dashglass dashboard.
 * Best-effort by design: panel types without a migration keep their
 * Grafana type as an (unregistered) plugin kind, so nothing is lost and
 * the renderer degrades gracefully; approximations land in `warnings`.
 */
export function importGrafanaDashboard(
  input: unknown,
  options: GrafanaImportOptions = {},
): GrafanaImportResult {
  if (typeof input !== "object" || input === null) {
    throw new Error("not a Grafana dashboard: expected a JSON object");
  }
  const grafana = input as GrafanaDashboard;
  if (!Array.isArray(grafana.panels)) {
    if (Array.isArray(grafana.rows) && grafana.rows.length > 0) {
      throw new Error(
        "this dashboard uses the pre-Grafana-5 rows layout (schemaVersion " +
          `${grafana.schemaVersion ?? "?"}); re-save it with a recent Grafana first`,
      );
    }
    throw new Error("not a Grafana dashboard: missing panels array");
  }

  const warnings: string[] = [];
  const warn = (message: string) => warnings.push(message);
  const migrations = [...(options.migrations ?? []), ...BUILTIN_MIGRATIONS];

  const usedKeys = new Map<string, number>();
  const reserveKey = (title: string): string => {
    const base = slugify(title, "panel");
    const count = usedKeys.get(base) ?? 0;
    usedKeys.set(base, count + 1);
    return count === 0 ? base : `${base}-${count + 1}`;
  };

  const panels: Record<string, Panel> = {};
  const layouts: GridLayout[] = [];

  for (const section of splitSections(grafana.panels, reserveKey)) {
    const yOffset = Math.min(
      ...section.panels.map((entry) => entry.grafana.gridPos?.y ?? 0),
    );
    const items: GridItem[] = [];

    for (const { key, grafana: panel } of section.panels) {
      const migration = migrations.find((entry) =>
        entry.types.includes(panel.type ?? ""),
      );
      let plugin: Panel["spec"]["plugin"];
      if (migration) {
        const spec = migration.migrateSpec(panel, warn);
        plugin = {
          kind: migration.kind,
          ...(Object.keys(spec).length > 0 ? { spec } : {}),
        };
      } else {
        warn(
          `panel "${panel.title ?? key}": type "${panel.type ?? "?"}" has no ` +
            "mapping — imported as-is, it will render as an unknown panel",
        );
        plugin = { kind: `grafana/${panel.type ?? "unknown"}` };
      }

      const queries = migrateQueries(panel, warn);
      const display = {
        ...(panel.title ? { name: panel.title } : {}),
        ...(panel.description ? { description: panel.description } : {}),
      };
      panels[key] = {
        kind: "Panel",
        spec: {
          ...(Object.keys(display).length > 0 ? { display } : {}),
          plugin,
          ...(queries.length > 0 ? { queries } : {}),
        },
      };
      items.push(toGridItem(panel, key, yOffset));
    }

    layouts.push({
      kind: "Grid",
      spec: {
        ...(section.title ? { display: { title: section.title } } : {}),
        items,
      },
    });
  }

  const variables: Variable[] = migrateVariables(
    grafana.templating?.list ?? [],
    warn,
  );

  const from = grafana.time?.from ?? "";
  const durationMatch = from.match(/^now-(\d+[smhdwy])$/);
  const refresh =
    typeof grafana.refresh === "string" &&
    /^(\d+(ms|s|m|h|d|w|y))+$/.test(grafana.refresh)
      ? grafana.refresh
      : undefined;

  const title = grafana.title ?? "Imported dashboard";
  const dashboard: Dashboard = dashboardSchema.parse({
    apiVersion: "v1",
    kind: "Dashboard",
    metadata: { name: slugify(title, "imported-dashboard") },
    spec: {
      display: {
        name: title,
        ...(grafana.description ? { description: grafana.description } : {}),
      },
      ...(variables.length > 0 ? { variables } : {}),
      panels,
      layouts,
      ...(durationMatch ? { duration: durationMatch[1] } : {}),
      ...(refresh ? { refreshInterval: refresh } : {}),
    },
  });

  return { dashboard, warnings };
}
