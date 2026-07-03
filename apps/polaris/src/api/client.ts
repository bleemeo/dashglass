/**
 * Client for the Polaris management API (DESIGN.md §7.2) — the contract
 * the Go backend implements natively and a SaaS backend can provide
 * behind a façade.
 */

export interface DashboardInfo {
  name: string;
  format: "json" | "yaml" | "toml";
  displayName?: string;
  description?: string;
  invalid?: boolean;
}

export interface Capabilities {
  version: string;
  readonly: boolean;
  formats: string[];
  prometheus: boolean;
  features?: { grafanaCom?: boolean };
}

export interface GrafanaComDashboard {
  dashboard: unknown;
  name?: string;
  description?: string;
  revision?: number;
}

export interface DashboardFile {
  content: string;
  format: "json" | "yaml" | "toml";
}

const CONTENT_TYPES = {
  json: "application/json",
  yaml: "application/yaml",
  toml: "application/toml",
} as const;

export class APIError extends Error {
  issues: string[];

  constructor(message: string, issues: string[] = []) {
    super(message);
    this.issues = issues;
  }
}

async function errorFrom(response: Response): Promise<APIError> {
  const body = (await response.json().catch(() => ({}))) as {
    error?: string;
    issues?: string[];
  };
  return new APIError(
    body.error ?? `HTTP ${response.status}`,
    body.issues ?? [],
  );
}

export async function fetchCapabilities(): Promise<Capabilities> {
  const response = await fetch("/api/capabilities");
  if (!response.ok) {
    throw await errorFrom(response);
  }
  return response.json() as Promise<Capabilities>;
}

/** Downloads a marketplace dashboard through the backend's pinned proxy. */
export async function fetchGrafanaComDashboard(
  id: string,
): Promise<GrafanaComDashboard> {
  const response = await fetch(`/api/grafana-com/${encodeURIComponent(id)}`);
  if (!response.ok) {
    throw await errorFrom(response);
  }
  return response.json() as Promise<GrafanaComDashboard>;
}

/**
 * Dashboard names may contain one folder level ("infra/db"): encode each
 * path segment but keep the separator, matching the backend's wildcard
 * route.
 */
function dashboardPath(name: string): string {
  return name.split("/").map(encodeURIComponent).join("/");
}

export async function listDashboards(): Promise<DashboardInfo[]> {
  const response = await fetch("/api/dashboards");
  if (!response.ok) {
    throw await errorFrom(response);
  }
  return response.json() as Promise<DashboardInfo[]>;
}

export async function getDashboardFile(name: string): Promise<DashboardFile> {
  const response = await fetch(`/api/dashboards/${dashboardPath(name)}`);
  if (!response.ok) {
    throw await errorFrom(response);
  }
  const format = (response.headers.get("X-Dashboard-Format") ??
    "yaml") as DashboardFile["format"];
  return { content: await response.text(), format };
}

export async function putDashboard(
  name: string,
  content: string,
  format: DashboardFile["format"],
): Promise<void> {
  const response = await fetch(`/api/dashboards/${dashboardPath(name)}`, {
    method: "PUT",
    headers: { "Content-Type": CONTENT_TYPES[format] },
    body: content,
  });
  if (!response.ok) {
    throw await errorFrom(response);
  }
}

export async function deleteDashboard(name: string): Promise<void> {
  const response = await fetch(`/api/dashboards/${dashboardPath(name)}`, {
    method: "DELETE",
  });
  if (!response.ok && response.status !== 404) {
    throw await errorFrom(response);
  }
}
