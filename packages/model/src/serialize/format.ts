import { parse as parseToml, stringify as stringifyToml } from "smol-toml";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";

import { migrateDashboard } from "../migrate";
import { dashboardSchema, type Dashboard } from "../schema/dashboard";
import { canonicalize } from "./canonical";

export const DASHBOARD_FORMATS = ["json", "yaml", "toml"] as const;
export type DashboardFormat = (typeof DASHBOARD_FORMATS)[number];

const EXTENSIONS: Record<string, DashboardFormat> = {
  json: "json",
  yaml: "yaml",
  yml: "yaml",
  toml: "toml",
};

/** Maps a file name/path to a dashboard format, by extension. */
export function detectFormat(path: string): DashboardFormat | undefined {
  const extension = path.slice(path.lastIndexOf(".") + 1).toLowerCase();
  return EXTENSIONS[extension];
}

function decode(content: string, format: DashboardFormat): unknown {
  switch (format) {
    case "json":
      return JSON.parse(content);
    case "yaml":
      return parseYaml(content);
    case "toml":
      return parseToml(content);
  }
}

/**
 * Decodes, migrates to the current apiVersion and validates. Throws
 * `ZodError` on invalid documents (or the decoder's error on syntax issues).
 */
export function parseDashboard(
  content: string,
  format: DashboardFormat,
): Dashboard {
  return dashboardSchema.parse(migrateDashboard(decode(content, format)));
}

/**
 * Validates and encodes in canonical form (see `canonicalize`). Output is
 * deterministic: the same dashboard always produces the same bytes.
 */
export function stringifyDashboard(
  dashboard: Dashboard,
  format: DashboardFormat,
): string {
  const canonical = canonicalize(dashboardSchema.parse(dashboard));
  switch (format) {
    case "json":
      return `${JSON.stringify(canonical, null, 2)}\n`;
    case "yaml":
      // No line wrapping: a long PromQL expression must stay on one line,
      // otherwise editing a neighbouring field rewraps it and pollutes the
      // git diff (the one-field-edit → one-line-diff rule).
      return stringifyYaml(canonical, { lineWidth: 0 });
    case "toml":
      return stringifyToml(canonical) + "\n";
  }
}
