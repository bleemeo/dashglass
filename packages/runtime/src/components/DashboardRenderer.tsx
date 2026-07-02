import type { CSSProperties } from "react";

import {
  panelKeyFromRef,
  type Dashboard,
  type GridLayout,
} from "@polarisui/model";

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
}: {
  layout: GridLayout;
  dashboard: Dashboard;
}) {
  const title = layout.spec.display?.title;
  return (
    <section className="polaris-grid-section">
      {title ? <h2 className="polaris-grid-title">{title}</h2> : null}
      <div className="polaris-grid" style={gridStyle}>
        {layout.spec.items.map((item, index) => {
          const panelKey = panelKeyFromRef(item.content.$ref);
          const panel = dashboard.spec.panels[panelKey];
          if (!panel) {
            return null; // Schema validation prevents dangling refs.
          }
          return (
            <div
              key={`${panelKey}-${index}`}
              className="polaris-grid-item"
              style={{
                gridColumn: `${item.x + 1} / span ${item.width}`,
                gridRow: `${item.y + 1} / span ${item.height}`,
                minWidth: 0,
              }}
            >
              <PanelChrome panelKey={panelKey} panel={panel} />
            </div>
          );
        })}
      </div>
    </section>
  );
}

export interface DashboardRendererProps {
  dashboard: Dashboard;
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
      <div className="polaris-dashboard">
        {dashboard.spec.layouts.map((layout, index) => (
          <GridSection key={index} layout={layout} dashboard={dashboard} />
        ))}
      </div>
    </VariablesProvider>
  );
}

/** The initial time range for a dashboard, from its spec. */
export function defaultTimeRange(dashboard: Dashboard) {
  return { pastDuration: dashboard.spec.duration ?? "1h" } as const;
}
