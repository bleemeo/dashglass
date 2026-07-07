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
  /** Number of panels (list-view metadata). */
  panels?: number;
  /** File last-modified time (RFC3339). */
  modified?: string;
  invalid?: boolean;
}

export interface Capabilities {
  version: string;
  readonly: boolean;
  formats: string[];
  prometheus: boolean;
  auth?: { kind: "none" | "builtin" | "proxy" | "oidc" };
  features?: { grafanaCom?: boolean };
}

export type Role = "viewer" | "editor" | "admin";

export interface AuthMe {
  authEnabled: boolean;
  authenticated: boolean;
  username?: string;
  role?: Role;
  /** True when a reverse proxy is the identity source (no local login). */
  proxy?: boolean;
}

export interface AdminUser {
  username: string;
  role: Role;
}

export interface ConfigSetting {
  key: string;
  value: string;
  source: "default" | "file" | "env" | "flag";
  secret?: boolean;
}

export interface AdminConfig {
  settings: ConfigSetting[];
  /** Present in proxy mode: read-only group → role mapping. */
  roleMapping?: { admin?: string[]; editor?: string[]; viewer?: string[] };
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
  status: number;

  constructor(message: string, issues: string[] = [], status = 0) {
    super(message);
    this.issues = issues;
    this.status = status;
  }
}

/** True for errors a retry cannot fix (4xx client errors). */
export function isClientError(error: unknown): boolean {
  return (
    error instanceof APIError && error.status >= 400 && error.status < 500
  );
}

export function isNotFound(error: unknown): boolean {
  return error instanceof APIError && error.status === 404;
}

async function errorFrom(response: Response): Promise<APIError> {
  // A 401 means the session is gone: land on the login page (except when
  // already there — the login POST handles its own errors), carrying the
  // current location so signing back in returns to it.
  if (
    response.status === 401 &&
    !window.location.pathname.startsWith("/login")
  ) {
    const next = encodeURIComponent(
      window.location.pathname + window.location.search,
    );
    window.location.assign(`/login?reason=expired&next=${next}`);
  }
  const body = (await response.json().catch(() => ({}))) as {
    error?: string;
    issues?: string[];
  };
  return new APIError(
    body.error ?? `HTTP ${response.status}`,
    body.issues ?? [],
    response.status,
  );
}

// --- Authentication (DESIGN.md §7.4) ----------------------------------------

export async function fetchAuthMe(): Promise<AuthMe> {
  const response = await fetch("/api/auth/me");
  if (!response.ok) {
    throw await errorFrom(response);
  }
  return response.json() as Promise<AuthMe>;
}

export async function login(username: string, password: string): Promise<void> {
  const response = await fetch("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  if (!response.ok) {
    throw await errorFrom(response);
  }
}

export async function logout(): Promise<void> {
  const response = await fetch("/api/auth/logout", { method: "POST" });
  if (!response.ok && response.status !== 401) {
    throw await errorFrom(response);
  }
}

/** Self-service password change; the session stays alive (fresh cookie). */
export async function changePassword(
  current: string,
  next: string,
): Promise<void> {
  const response = await fetch("/api/auth/password", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ current, new: next }),
  });
  if (!response.ok) {
    throw await errorFrom(response);
  }
}

export async function adminListUsers(): Promise<AdminUser[]> {
  const response = await fetch("/api/admin/users");
  if (!response.ok) {
    throw await errorFrom(response);
  }
  return response.json() as Promise<AdminUser[]>;
}

export async function adminCreateUser(
  username: string,
  password: string,
  role: Role,
): Promise<void> {
  const response = await fetch("/api/admin/users", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password, role }),
  });
  if (!response.ok) {
    throw await errorFrom(response);
  }
}

export async function adminUpdateUser(
  username: string,
  updates: { role?: Role; password?: string },
): Promise<void> {
  const response = await fetch(
    `/api/admin/users/${encodeURIComponent(username)}`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(updates),
    },
  );
  if (!response.ok) {
    throw await errorFrom(response);
  }
}

export async function adminDeleteUser(username: string): Promise<void> {
  const response = await fetch(
    `/api/admin/users/${encodeURIComponent(username)}`,
    { method: "DELETE" },
  );
  if (!response.ok) {
    throw await errorFrom(response);
  }
}

export async function adminConfig(): Promise<AdminConfig> {
  const response = await fetch("/api/admin/config");
  if (!response.ok) {
    throw await errorFrom(response);
  }
  return response.json() as Promise<AdminConfig>;
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
  options: { createOnly?: boolean } = {},
): Promise<void> {
  const headers: Record<string, string> = {
    "Content-Type": CONTENT_TYPES[format],
  };
  if (options.createOnly) {
    // The backend then refuses to overwrite an existing dashboard (409).
    headers["If-None-Match"] = "*";
  }
  const response = await fetch(`/api/dashboards/${dashboardPath(name)}`, {
    method: "PUT",
    headers,
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
