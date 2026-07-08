import type { CSSProperties } from "react";

import {
  panelKeyFromRef,
  type Dashboard,
  type GridLayout,
} from "@dashglass/model";

import { VariablesProvider } from "../context";
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

function GridSection({
  layout,
  dashboard,
  onPanelExpand,
}: {
  layout: GridLayout;
  dashboard: Dashboard;
  onPanelExpand?: ((panelKey: string) => void) | undefined;
}) {
  const title = layout.spec.display?.title;
  return (
    <section className="dashglass-grid-section">
      {title ? <h2 className="dashglass-grid-title">{title}</h2> : null}
      <div className="dashglass-grid" style={gridStyle}>
        {layout.spec.items.map((item, index) => {
          const panelKey = panelKeyFromRef(item.content.$ref);
          const panel = dashboard.spec.panels[panelKey];
          if (!panel) {
            return null; // Schema validation prevents dangling refs.
          }
          return (
            <div
              key={`${panelKey}-${index}`}
              className="dashglass-grid-item"
              style={{
                gridColumn: `${item.x + 1} / span ${item.width}`,
                gridRow: `${item.y + 1} / span ${item.height}`,
                minWidth: 0,
              }}
            >
              <PanelChrome
                panelKey={panelKey}
                panel={panel}
                onExpand={
                  onPanelExpand ? () => onPanelExpand(panelKey) : undefined
                }
              />
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
