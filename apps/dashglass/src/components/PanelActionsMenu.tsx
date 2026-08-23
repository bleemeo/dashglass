import { IconButton, Menu, Portal } from "@chakra-ui/react";
import { Link } from "react-router";

import type { Panel } from "@dashglass/model";
import {
  interpolate,
  panelPromQL,
  useTimeRange,
  useVariables,
} from "@dashglass/runtime";

import { MoreIcon } from "./icons";
import { toaster } from "./toaster";
import { exploreHref } from "./URLStateSync";

async function copyToClipboard(text: string, label: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    toaster.create({ title: `${label} copied`, type: "success" });
  } catch {
    // Clipboard access is denied outside a secure context (plain HTTP on a
    // hostname other than localhost) — a common Dashglass deployment.
    toaster.create({
      title: "Could not copy to the clipboard",
      description: "The browser denied clipboard access on this page.",
      type: "error",
    });
  }
}

/**
 * Per-panel overflow menu (⋯) on a viewed dashboard: hands the panel's
 * *resolved* PromQL — variables and repeat instance applied — to Explore
 * or the clipboard, the mirror of Explore's "Add to dashboard".
 *
 * Rendered inside the panel's provider scope, so `useVariables()` here
 * returns the values that panel is actually querying with.
 */
export function PanelActionsMenu({
  panelKey,
  panel,
  onExpand,
}: {
  panelKey: string;
  panel: Panel;
  onExpand?: (() => void) | undefined;
}) {
  const { values } = useVariables();
  const { range } = useTimeRange();
  const queries = panelPromQL(panel, values);
  const rawTitle = panel.spec.display?.name;
  const title = rawTitle ? interpolate(rawTitle, values) : panelKey;
  const single = queries.length === 1;

  if (queries.length === 0 && !onExpand) {
    // Nothing to offer (a Markdown or Clock panel, already fullscreen):
    // no trigger rather than an empty menu.
    return null;
  }

  return (
    <Menu.Root>
      <Menu.Trigger asChild>
        <IconButton
          size="2xs"
          variant="ghost"
          color="fg.muted"
          aria-label={`Actions for ${title}`}
          // Quiet until the panel is hovered (see .dashglass-panel-actions).
          data-hover-reveal=""
        >
          <MoreIcon />
        </IconButton>
      </Menu.Trigger>
      <Portal>
        <Menu.Positioner>
          <Menu.Content minWidth="180px">
            {onExpand ? (
              // Also the only fullscreen affordance for an untitled panel:
              // the header has no title button to click.
              <Menu.Item value="fullscreen" onClick={onExpand}>
                View fullscreen
              </Menu.Item>
            ) : null}
            {queries.length > 0 && onExpand ? <Menu.Separator /> : null}
            {queries.map((expr, index) => (
              <Menu.Item key={index} value={`explore-${index}`} asChild>
                {/* An anchor, not a click handler: middle-click and
                    ⌘-click open the session in a new tab. */}
                <Link to={exploreHref(expr, range)} title={expr}>
                  {single ? "Explore query" : `Explore query ${index + 1}`}
                </Link>
              </Menu.Item>
            ))}
            {queries.length > 0 ? (
              <Menu.Item
                value="copy"
                onClick={() => {
                  void copyToClipboard(
                    queries.join("\n"),
                    single ? "Query" : "Queries",
                  );
                }}
              >
                {single ? "Copy PromQL" : "Copy all PromQL"}
              </Menu.Item>
            ) : null}
          </Menu.Content>
        </Menu.Positioner>
      </Portal>
    </Menu.Root>
  );
}
