import type { CSSProperties, ReactNode } from "react";

import {
  panelKeyFromRef,
  type Dashboard,
  type GridLayout,
  type Panel,
} from "@dashglass/model";

import { PinnedVariablesProvider, useVariables, VariablesProvider } from "../context";
import type { VariableValues } from "../interpolate";
import { placeItems, type RepeatableItem } from "../repeat";
import { PanelChrome } from "./PanelChrome";

/** The dashboard grid is 24 columns wide (Perses convention). */
export const GRID_COLUMNS = 24;
/** Height of one grid row, in pixels. */
export const GRID_ROW_HEIGHT = 36;
export const GRID_GAP = 8;

const gridStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: `repeat(${GRID_COLUMNS}, 1fr)`,
  gridAutoRows: GRID_ROW_HEIGHT,
  gap: GRID_GAP,
};

/**
 * The values a panel repeats over: the current selection of its repeat
 * variable, or all loaded options when "All" (the `.+` sentinel) or an
 * empty multi-selection is active.
 */
function repeatValues(
  name: string,
  values: VariableValues,
  options: Record<string, string[]>,
): string[] {
  const raw = values[name];
  if (raw === ".+") {
    return options[name] ?? [];
  }
  if (Array.isArray(raw)) {
    return raw.length > 0 ? raw : (options[name] ?? []);
  }
  if (typeof raw === "string" && raw !== "") {
    return [raw];
  }
  return options[name] ?? [];
}

function GridSection({
  layout,
  dashboard,
  onPanelExpand,
  renderPanelActions,
}: {
  layout: GridLayout;
  dashboard: Dashboard;
  onPanelExpand?: ((panelKey: string) => void) | undefined;
  renderPanelActions?: PanelActionsRenderer | undefined;
}) {
  const { values, options } = useVariables();
  const title = layout.spec.display?.title;

  const items: RepeatableItem[] = layout.spec.items.flatMap((item) => {
    const panelKey = panelKeyFromRef(item.content.$ref);
    const panel = dashboard.spec.panels[panelKey];
    if (!panel) {
      return []; // Schema validation prevents dangling refs.
    }
    const repeat = panel.spec.repeat;
    return [
      {
        panelKey,
        x: item.x,
        y: item.y,
        width: item.width,
        height: item.height,
        repeat: repeat
          ? {
              variable: repeat.variable,
              values: repeatValues(repeat.variable, values, options),
              direction: repeat.direction,
              maxPerRow: repeat.maxPerRow,
            }
          : undefined,
      },
    ];
  });

  return (
    <section className="dashglass-grid-section">
      {title ? <h2 className="dashglass-grid-title">{title}</h2> : null}
      <div className="dashglass-grid" style={gridStyle}>
        {placeItems(items, GRID_COLUMNS).map((placed) => {
          const panel = dashboard.spec.panels[placed.panelKey]!;
          const chrome = (
            <PanelChrome
              panelKey={placed.panelKey}
              panel={panel}
              onExpand={
                onPanelExpand
                  ? () => onPanelExpand(placed.panelKey)
                  : undefined
              }
              actions={renderPanelActions?.({
                panelKey: placed.panelKey,
                panel,
              })}
            />
          );
          return (
            <div
              key={placed.key}
              className="dashglass-grid-item"
              style={{
                gridColumn: `${placed.x + 1} / span ${placed.width}`,
                gridRow: `${placed.y + 1} / span ${placed.height}`,
                minWidth: 0,
              }}
            >
              {placed.pinned ? (
                <PinnedVariablesProvider
                  overrides={{ [placed.pinned.name]: placed.pinned.value }}
                >
                  {chrome}
                </PinnedVariablesProvider>
              ) : (
                chrome
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

/**
 * Builds the per-panel header controls. The node it returns is mounted
 * inside the panel's own provider scope, so components in it may use the
 * runtime hooks and see the panel's variable values (a repeated instance
 * sees its pinned value, not the whole selection).
 */
export type PanelActionsRenderer = (context: {
  panelKey: string;
  panel: Panel;
}) => ReactNode;

export interface DashboardRendererProps {
  dashboard: Dashboard;
  /** When set, panel titles become buttons (e.g. fullscreen view). */
  onPanelExpand?: ((panelKey: string) => void) | undefined;
  /** Per-panel header controls, e.g. an overflow menu. */
  renderPanelActions?: PanelActionsRenderer | undefined;
}

/**
 * The dashboard grids alone: requires <RuntimeProvider>,
 * <TimeRangeProvider> AND <VariablesProvider> above it. Use this instead
 * of DashboardRenderer when the host renders its own variables toolbar
 * inside the provider scope.
 */
export function DashboardGrid({
  dashboard,
  onPanelExpand,
  renderPanelActions,
}: DashboardRendererProps) {
  return (
    <div className="dashglass-dashboard">
      {dashboard.spec.layouts.map((layout, index) => (
        <GridSection
          key={index}
          layout={layout}
          dashboard={dashboard}
          onPanelExpand={onPanelExpand}
          renderPanelActions={renderPanelActions}
        />
      ))}
    </div>
  );
}

/**
 * Renders a dashboard read-only: grids of panels fed by the query
 * orchestrator. Requires <RuntimeProvider> and <TimeRangeProvider> above it
 * (the time-range picker lives in the host app's toolbar); dashboard
 * variables are scoped here.
 *
 * This is the component the Bleemeo panel embeds in the convergence
 * scenario (DESIGN.md §9).
 */
export function DashboardRenderer({ dashboard }: DashboardRendererProps) {
  return (
    <VariablesProvider variables={dashboard.spec.variables}>
      <DashboardGrid dashboard={dashboard} />
    </VariablesProvider>
  );
}

/** The initial time range for a dashboard, from its spec. */
export function defaultTimeRange(dashboard: Dashboard) {
  return { pastDuration: dashboard.spec.duration ?? "1h" } as const;
}
