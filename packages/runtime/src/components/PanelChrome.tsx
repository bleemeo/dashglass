import type { CSSProperties } from "react";

import type { Panel } from "@polarisui/model";

import { useRuntime, useTimeRange } from "../context";
import { usePanelData } from "../panel-data";

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
}

export function PanelChrome({ panelKey, panel }: PanelChromeProps) {
  const { registries } = useRuntime();
  const { resolved } = useTimeRange();
  const data = usePanelData(panel);

  const kind = panel.spec.plugin.kind;
  const plugin = registries.panels.get(kind);
  const title = panel.spec.display?.name ?? panelKey;

  let body;
  if (!plugin) {
    // Unknown kinds degrade gracefully: an OSS install can open a
    // dashboard using proprietary panel kinds without crashing.
    body = (
      <p className="polaris-panel-unknown">
        Unknown panel kind “{kind}” — no plugin registered.
      </p>
    );
  } else if (data.state === "error") {
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
      <Component
        spec={panel.spec.plugin.spec ?? {}}
        display={panel.spec.display}
        data={data}
        timeRange={resolved}
      />
    );
  }

  return (
    <section
      className="polaris-panel"
      style={chromeStyle}
      aria-label={title}
      data-panel-key={panelKey}
    >
      <header className="polaris-panel-header">
        <h3 className="polaris-panel-title">{title}</h3>
      </header>
      <div className="polaris-panel-body" style={bodyStyle}>
        {body}
      </div>
    </section>
  );
}
