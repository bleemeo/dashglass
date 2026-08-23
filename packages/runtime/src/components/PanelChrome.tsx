import { Suspense, type CSSProperties, type ReactNode } from "react";

import type { Panel } from "@dashglass/model";

import { useRuntime, useTimeRange, useVariables } from "../context";
import { interpolate, interpolateUrl, type VariableValues } from "../interpolate";
import { usePanelData } from "../panel-data";
import { PanelErrorBoundary } from "./PanelErrorBoundary";

/**
 * Structure-only styling: the chrome exposes dashglass-* class names and
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
  /**
   * Host-supplied controls (typically an overflow menu) rendered at the
   * right of the header. The chrome only places them: what a panel action
   * *is* — a route, the clipboard — belongs to the host, not the runtime.
   */
  actions?: ReactNode;
}

export function PanelChrome({
  panelKey,
  panel,
  onExpand,
  actions,
}: PanelChromeProps) {
  const { registries } = useRuntime();
  const { resolved, setRange } = useTimeRange();
  const { values } = useVariables();
  const data = usePanelData(panel);

  const kind = panel.spec.plugin.kind;
  const plugin = registries.panels.get(kind);
  // Visible title only when the panel actually has one; the panel key is
  // an internal identifier, not a fallback label. The header itself stays
  // (drag handle in the editor, fullscreen affordance) — it just shows no
  // text when untitled. Variables are interpolated so a repeated panel can
  // label itself with its instance value (name: "CPU — $instance").
  const rawTitle = panel.spec.display?.name;
  const title = rawTitle ? interpolate(rawTitle, values) : rawTitle;
  // The description is authored in the panel editor and only surfaces here,
  // as a hover/focus tooltip on an info marker. Interpolated like the title
  // so a repeated panel can describe its own instance.
  const rawDescription = panel.spec.display?.description?.trim();
  const description = rawDescription
    ? interpolate(rawDescription, values)
    : undefined;

  // Data links: variables plus the time-range tokens $__from / $__to (epoch
  // milliseconds) are interpolated into each URL, so a link can carry the
  // current context to another dashboard or an external tool.
  const links = (panel.spec.links ?? []).filter(
    (link) => link.url.trim() !== "",
  );
  const linkValues: VariableValues = {
    ...values,
    __from: String(resolved.start.getTime()),
    __to: String(resolved.end.getTime()),
  };

  let body;
  if (!plugin) {
    // Unknown kinds degrade gracefully: an OSS install can open a
    // dashboard using proprietary panel kinds without crashing.
    body = (
      <p className="dashglass-panel-unknown">
        Unknown panel kind “{kind}” — no plugin registered.
      </p>
    );
  } else if (data.state === "loading" && data.series.length === 0) {
    // First load only: refreshes keep the previous series on screen.
    body = <div className="dashglass-panel-loading" aria-busy="true" />;
  } else if (data.state === "error" && data.series.length === 0) {
    body = (
      <div className="dashglass-panel-error" role="alert">
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
            className="dashglass-panel-error-badge"
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
          <div className="dashglass-panel-refreshing" aria-hidden="true" />
        ) : null}
      </>
    );
  }

  return (
    <section
      className="dashglass-panel"
      style={chromeStyle}
      aria-label={title ?? panelKey}
      data-panel-key={panelKey}
    >
      <header className="dashglass-panel-header">
        {description ? (
          // Leading marker: the title is an ellipsizing flex child, so the
          // icon cannot live inside it without being clipped away.
          <span
            className="dashglass-panel-description"
            role="img"
            tabIndex={0}
            title={description}
            aria-label={`Description: ${description}`}
          >
            <svg
              viewBox="0 0 16 16"
              width="12"
              height="12"
              aria-hidden="true"
              focusable="false"
            >
              <circle
                cx="8"
                cy="8"
                r="7"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
              />
              <path
                d="M8 7v4.5"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
              />
              <circle cx="8" cy="4.6" r="0.9" fill="currentColor" />
            </svg>
          </span>
        ) : null}
        {/* The title attribute carries the full text: narrow tiles
            ellipsize it, and the tooltip is the only way to read it. */}
        <h3 className="dashglass-panel-title" title={title ?? undefined}>
          {onExpand ? (
            <button
              type="button"
              className="dashglass-panel-expand"
              aria-label={title ? `${title} — view fullscreen` : "View fullscreen"}
              onClick={onExpand}
            >
              {title}
            </button>
          ) : (
            title
          )}
        </h3>
        {links.length > 0 ? (
          <nav className="dashglass-panel-links" aria-label="Panel links">
            {links.map((link, index) => {
              const href = interpolateUrl(link.url, linkValues);
              return (
                <a
                  key={index}
                  className="dashglass-panel-link"
                  href={href}
                  title={link.title ?? href}
                  {...(link.targetBlank
                    ? { target: "_blank", rel: "noreferrer noopener" }
                    : {})}
                >
                  {link.title ?? "Link"}
                </a>
              );
            })}
          </nav>
        ) : null}
        {actions ? (
          <div className="dashglass-panel-actions">{actions}</div>
        ) : null}
      </header>
      <div className="dashglass-panel-body" style={bodyStyle}>
        <PanelErrorBoundary resetKey={panel}>{body}</PanelErrorBoundary>
      </div>
    </section>
  );
}
