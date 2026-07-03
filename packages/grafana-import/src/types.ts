/**
 * The subset of the Grafana dashboard JSON model the importer reads.
 * Everything is optional/loose on purpose: the format spans fifteen years
 * of schema versions and the importer is best-effort by design.
 */

export interface GrafanaGridPos {
  x?: number;
  y?: number;
  w?: number;
  h?: number;
}

export interface GrafanaTarget {
  expr?: string;
  legendFormat?: string;
  interval?: string;
  hide?: boolean;
}

export interface GrafanaPanel {
  type?: string;
  title?: string;
  description?: string;
  gridPos?: GrafanaGridPos;
  targets?: GrafanaTarget[];
  fieldConfig?: {
    defaults?: {
      unit?: string;
      min?: number;
      max?: number;
      decimals?: number;
      custom?: {
        stacking?: { mode?: string };
        fillOpacity?: number;
      };
      thresholds?: {
        steps?: { color?: string; value?: number | null }[];
      };
    };
  };
  options?: Record<string, unknown>;
  // Legacy panels (graph, singlestat, text < v7) carry flat fields.
  [key: string]: unknown;
  // Row panels
  collapsed?: boolean;
  panels?: GrafanaPanel[];
}

export interface GrafanaTemplateVar {
  type?: string;
  name?: string;
  label?: string;
  query?: string | { query?: string };
  multi?: boolean;
  includeAll?: boolean;
  current?: { value?: string | string[] };
}

export interface GrafanaDashboard {
  title?: string;
  description?: string;
  uid?: string;
  time?: { from?: string };
  refresh?: string | false;
  panels?: GrafanaPanel[];
  templating?: { list?: GrafanaTemplateVar[] };
  // Pre-v16 schema (Grafana < 5): row-based layout, unsupported.
  rows?: unknown[];
  schemaVersion?: number;
}
