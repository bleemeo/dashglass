import type { CSSProperties } from "react";

import {
  panelKeyFromRef,
  type Dashboard,
  type GridLayout,
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
}: {
  layout: GridLayout;
  dashboard: Dashboard;
  onPanelExpand?: ((panelKey: string) => void) | undefined;
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

export interface DashboardRendererProps {
  dashboard: Dashboard;
  /** When set, panel titles become buttons (e.g. fullscreen view). */
  onPanelExpand?: ((panelKey: string) => void) | undefined;
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
}: DashboardRendererProps) {
  return (
    <div className="dashglass-dashboard">
      {dashboard.spec.layouts.map((layout, index) => (
        <GridSection
          key={index}
          layout={layout}
          dashboard={dashboard}
          onPanelExpand={onPanelExpand}
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
