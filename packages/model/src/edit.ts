import type { Dashboard } from "./schema/dashboard";
import {
  panelKeyFromRef,
  panelRefFromKey,
  type GridItem,
  type GridLayout,
} from "./schema/layouts";
import type { Panel } from "./schema/panels";
import type { Variable } from "./schema/variables";

/**
 * Pure editing operations on the dashboard document, shared by form-based
 * editors (the OSS app today, the SaaS panel later). Every operation
 * returns a new Dashboard and never mutates its input, so hosts can keep
 * drafts in immutable state and implement discard/undo by keeping old
 * references.
 */

function withSpec(
  dashboard: Dashboard,
  spec: Partial<Dashboard["spec"]>,
): Dashboard {
  return { ...dashboard, spec: { ...dashboard.spec, ...spec } };
}

function withLayout(
  dashboard: Dashboard,
  layoutIndex: number,
  update: (layout: GridLayout) => GridLayout,
): Dashboard {
  return withSpec(dashboard, {
    layouts: dashboard.spec.layouts.map((layout, index) =>
      index === layoutIndex ? update(layout) : layout,
    ),
  });
}

/** First unused panel key: "panel", "panel-2", "panel-3"… */
export function uniquePanelKey(dashboard: Dashboard, base = "panel"): string {
  if (!(base in dashboard.spec.panels)) {
    return base;
  }
  let counter = 2;
  while (`${base}-${counter}` in dashboard.spec.panels) {
    counter += 1;
  }
  return `${base}-${counter}`;
}

/** Y coordinate of the first free row at the bottom of a layout. */
function bottomOf(layout: GridLayout): number {
  return layout.spec.items.reduce(
    (bottom, item) => Math.max(bottom, item.y + item.height),
    0,
  );
}

/**
 * Adds a panel to the panels map and places it at the bottom of the given
 * layout section.
 */
export function addPanel(
  dashboard: Dashboard,
  key: string,
  panel: Panel,
  layoutIndex: number,
  size: { width: number; height: number } = { width: 12, height: 8 },
): Dashboard {
  const item: GridItem = {
    x: 0,
    y: bottomOf(dashboard.spec.layouts[layoutIndex]!),
    width: size.width,
    height: size.height,
    content: { $ref: panelRefFromKey(key) },
  };
  const next = withSpec(dashboard, {
    panels: { ...dashboard.spec.panels, [key]: panel },
  });
  return withLayout(next, layoutIndex, (layout) => ({
    ...layout,
    spec: { ...layout.spec, items: [...layout.spec.items, item] },
  }));
}

/** Replaces the definition of an existing panel. */
export function updatePanel(
  dashboard: Dashboard,
  key: string,
  panel: Panel,
): Dashboard {
  return withSpec(dashboard, {
    panels: { ...dashboard.spec.panels, [key]: panel },
  });
}

/**
 * Removes a layout item; the referenced panel definition is dropped from
 * the panels map when no other layout item references it.
 */
export function removePanelAt(
  dashboard: Dashboard,
  layoutIndex: number,
  itemIndex: number,
): Dashboard {
  const removed = dashboard.spec.layouts[layoutIndex]?.spec.items[itemIndex];
  if (!removed) {
    return dashboard;
  }
  const next = withLayout(dashboard, layoutIndex, (layout) => ({
    ...layout,
    spec: {
      ...layout.spec,
      items: layout.spec.items.filter((_, index) => index !== itemIndex),
    },
  }));
  const key = panelKeyFromRef(removed.content.$ref);
  const stillReferenced = next.spec.layouts.some((layout) =>
    layout.spec.items.some((item) => item.content.$ref === removed.content.$ref),
  );
  if (stillReferenced) {
    return next;
  }
  const panels = { ...next.spec.panels };
  delete panels[key];
  return withSpec(next, { panels });
}

/** Replaces the items of a layout section (drag & drop / resize result). */
export function updateLayoutItems(
  dashboard: Dashboard,
  layoutIndex: number,
  items: GridItem[],
): Dashboard {
  return withLayout(dashboard, layoutIndex, (layout) => ({
    ...layout,
    spec: { ...layout.spec, items },
  }));
}

/** Appends an empty grid section. */
export function addLayout(dashboard: Dashboard, title?: string): Dashboard {
  const layout: GridLayout = {
    kind: "Grid",
    spec: {
      ...(title ? { display: { title } } : {}),
      items: [],
    },
  };
  return withSpec(dashboard, {
    layouts: [...dashboard.spec.layouts, layout],
  });
}

/**
 * Replaces the dashboard's variables (an empty list removes the field, so
 * a dashboard without variables serializes without a `variables:` key).
 */
export function setVariables(
  dashboard: Dashboard,
  variables: Variable[],
): Dashboard {
  if (variables.length === 0) {
    const spec = { ...dashboard.spec };
    delete spec.variables;
    return { ...dashboard, spec };
  }
  return withSpec(dashboard, { variables });
}

/** Retitles a grid section (an empty title removes the display block). */
export function setLayoutTitle(
  dashboard: Dashboard,
  layoutIndex: number,
  title: string,
): Dashboard {
  return withLayout(dashboard, layoutIndex, (layout) => {
    const spec = { ...layout.spec };
    if (title === "") {
      delete spec.display;
    } else {
      spec.display = { ...spec.display, title };
    }
    return { ...layout, spec };
  });
}
