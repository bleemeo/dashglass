import type { DashboardInfo } from "../api/client";

/**
 * Client-side dashboard list filter: case-insensitive substring over the
 * file name (including the folder), display name and description.
 */
export function filterDashboards(
  dashboards: DashboardInfo[],
  query: string,
): DashboardInfo[] {
  const needle = query.trim().toLowerCase();
  if (needle === "") {
    return dashboards;
  }
  return dashboards.filter((dashboard) =>
    [dashboard.name, dashboard.displayName ?? "", dashboard.description ?? ""]
      .join("\n")
      .toLowerCase()
      .includes(needle),
  );
}
