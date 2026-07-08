import type { ComponentType, ReactNode } from "react";

import type { Display } from "@dashglass/model";

import type {
  AbsoluteTimeRange,
  PrometheusDataSource,
  TimeSeries,
} from "./datasource";

/**
 * The extension points of the open-core model (DESIGN.md §7): the OSS app
 * and the SaaS panel assemble the same engine with different plugin sets.
 * Registries are explicit instances (no global singleton) so a host app —
 * or a test — controls exactly what is registered.
 */

class Registry<T extends { kind: string }> {
  private plugins = new Map<string, T>();

  register(plugin: T): void {
    if (this.plugins.has(plugin.kind)) {
      throw new Error(`plugin kind "${plugin.kind}" is already registered`);
    }
    this.plugins.set(plugin.kind, plugin);
  }

  get(kind: string): T | undefined {
    return this.plugins.get(kind);
  }

  list(): T[] {
    return [...this.plugins.values()];
  }
}

// --- Panel plugins --------------------------------------------------------

/** Data handed to a panel component, aggregated over its queries. */
export interface PanelData {
  state: "loading" | "ready" | "error";
  series: TimeSeries[];
  errors: string[];
}

export interface PanelProps<Spec = Record<string, unknown>> {
  /** The panel plugin spec from the dashboard file (kind-specific). */
  spec: Spec;
  display?: Display | undefined;
  data: PanelData;
  timeRange: AbsoluteTimeRange;
  /**
   * Set by the host when the panel may drive the shared time range
   * (brush-select to zoom in, double-click to zoom out).
   */
  onZoom?: ((range: AbsoluteTimeRange) => void) | undefined;
}

/**
 * Props of a plugin's options form. The editor mutates nothing: it reports
 * the full next spec through onChange and the host owns the draft state.
 */
export interface PanelSpecEditorProps<Spec = Record<string, unknown>> {
  spec: Spec;
  onChange: (spec: Spec) => void;
}

export interface PanelPlugin<Spec = Record<string, unknown>> {
  kind: string;
  component: ComponentType<PanelProps<Spec>>;
  /** Human label for the editor's kind picker; falls back to `kind`. */
  displayName?: string;
  /** Kind-specific options form shown by the panel editor. */
  editor?: ComponentType<PanelSpecEditorProps<Spec>>;
  /** Spec used when adding a new panel of this kind from the editor. */
  defaultSpec?: Spec;
}

export class PanelRegistry extends Registry<PanelPlugin> {}

// --- Pages (routes + navigation) ------------------------------------------

export interface PageDefinition {
  kind: string;
  /** Route path, react-router style (e.g. "/dashboards/:name"). */
  path: string;
  element: ReactNode;
  /** Present when the page appears in the navigation menu. */
  nav?: {
    title: string;
    icon?: ReactNode;
    order?: number;
  };
}

export class PageRegistry extends Registry<PageDefinition> {
  navPages(): PageDefinition[] {
    return this.list()
      .filter((page) => page.nav)
      .sort((a, b) => (a.nav?.order ?? 0) - (b.nav?.order ?? 0));
  }
}

// --- Variable sources ------------------------------------------------------

export interface VariableSourceContext {
  datasource: PrometheusDataSource;
  timeRange: AbsoluteTimeRange;
}

/** Provides the values of a ListVariable (e.g. Prometheus label values). */
export interface VariableSourcePlugin {
  kind: string;
  loadValues(
    spec: Record<string, unknown>,
    context: VariableSourceContext,
  ): Promise<string[]>;
}

export class VariableSourceRegistry extends Registry<VariableSourcePlugin> {}

// --- Container -------------------------------------------------------------

export interface Registries {
  panels: PanelRegistry;
  pages: PageRegistry;
  variableSources: VariableSourceRegistry;
}

export function createRegistries(): Registries {
  return {
    panels: new PanelRegistry(),
    pages: new PageRegistry(),
    variableSources: new VariableSourceRegistry(),
  };
}
