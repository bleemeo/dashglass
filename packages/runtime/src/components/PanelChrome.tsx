import { Suspense, type CSSProperties } from "react";

import type { Panel } from "@polarisui/model";

import { useRuntime, useTimeRange } from "../context";
import { usePanelData } from "../panel-data";
import { PanelErrorBoundary } from "./PanelErrorBoundary";

/**
 * Structure-only styling: the chrome exposes polaris-* class names and
 * leaves the visual identity to the host's theme (packages/ui or the SaaS
 * panel's own).
 */
const chromeStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  height: "100%",
  minWidth: 0,
  overflow: "hidden",
};

const bodyStyle: CSSProperties = { flex: 1, minHeight: 0, position: "relative" };

export interface PanelChromeProps {
  panelKey: string;
  panel: Panel;
  /** When set, the panel title becomes a button (e.g. expand fullscreen). */
  onExpand?: (() => void) | undefined;
}

export function PanelChrome({ panelKey, panel, onExpand }: PanelChromeProps) {
  const { registries } = useRuntime();
  const { resolved, setRange } = useTimeRange();
  const data = usePanelData(panel);

  const kind = panel.spec.plugin.kind;
  const plugin = registries.panels.get(kind);
  // Visible title only when the panel actually has one; the panel key is
  // an internal identifier, not a fallback label. The header itself stays
  // (drag handle in the editor, fullscreen affordance) — it just shows no
  // text when untitled.
  const title = panel.spec.display?.name;

  let body;
  if (!plugin) {
    // Unknown kinds degrade gracefully: an OSS install can open a
    // dashboard using proprietary panel kinds without crashing.
    body = (
      <p className="polaris-panel-unknown">
        Unknown panel kind “{kind}” — no plugin registered.
      </p>
    );
  } else if (data.state === "loading" && data.series.length === 0) {
    // First load only: refreshes keep the previous series on screen.
    body = <div className="polaris-panel-loading" aria-busy="true" />;
  } else if (data.state === "error" && data.series.length === 0) {
    body = (
      <div className="polaris-panel-error" role="alert">
        {data.errors.map((error, index) => (
          <p key={index}>{error}</p>
        ))}
      </div>
    );
  } else {
    const Component = plugin.component;
    body = (
      <>
        {/* Panel components may be React.lazy chunks (code splitting). */}
        <Suspense fallback={null}>
          <Component
            spec={panel.spec.plugin.spec ?? {}}
            display={panel.spec.display}
            data={data}
            timeRange={resolved}
            onZoom={setRange}
          />
        </Suspense>
        {data.state === "error" ? (
          // Partial failure: healthy queries keep their series on screen,
          // the failed ones surface as a badge (details on hover).
          <div
            className="polaris-panel-error-badge"
            role="alert"
            title={data.errors.join("\n\n")}
          >
            {data.errors.length === 1
              ? "1 query failed"
              : `${data.errors.length} queries failed`}
          </div>
        ) : null}
        {data.state === "loading" ? (
          // Refetch over stale data: a quiet cue that numbers are updating.
          <div className="polaris-panel-refreshing" aria-hidden="true" />
        ) : null}
      </>
    );
  }

  return (
    <section
      className="polaris-panel"
      style={chromeStyle}
      aria-label={title ?? panelKey}
      data-panel-key={panelKey}
    >
      <header className="polaris-panel-header">
        <h3 className="polaris-panel-title">
          {onExpand ? (
            <button
              type="button"
              className="polaris-panel-expand"
              title="View fullscreen"
              onClick={onExpand}
            >
              {title}
            </button>
          ) : (
            title
          )}
        </h3>
      </header>
      <div className="polaris-panel-body" style={bodyStyle}>
        <PanelErrorBoundary resetKey={panel}>{body}</PanelErrorBoundary>
      </div>
    </section>
  );
}
