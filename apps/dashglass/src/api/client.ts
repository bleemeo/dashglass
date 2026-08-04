/**
 * Client for the Dashglass management API (DESIGN.md §7.2) — the contract
 * the Go backend implements natively and a SaaS backend can provide
 * behind a façade.
 */

/** One panel's placement + kind, in grid units (24 columns). */
export interface PreviewItem {
  x: number;
  y: number;
  w: number;
  h: number;
  kind?: string;
}

export interface DashboardInfo {
  name: string;
  format: "json" | "yaml" | "toml";
  displayName?: string;
  description?: string;
  /** Number of panels (list-view metadata). */
  panels?: number;
  /** File last-modified time (RFC3339). */
  modified?: string;
  /** Compact layout summary for a schematic thumbnail. */
  preview?: PreviewItem[];
  invalid?: boolean;
}

export interface Capabilities {
  version: string;
  readonly: boolean;
  formats: string[];
  prometheus: boolean;
  auth?: { kind: "none" | "builtin" | "proxy" | "oidc" };
  features?: { grafanaCom?: boolean; history?: boolean };
}

/** One entry of a dashboard file's git history. */
export interface HistoryCommit {
  hash: string;
  author: string;
  /** Author date, RFC3339. */
  date: string;
  subject: string;
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

// Marks that this browser had an authenticated session at some point, so
// the login redirect can honestly distinguish "session expired" from
// "never signed in" (first visit to a protected instance).
const HAD_SESSION_KEY = "dashglass-had-session";

function rememberSession(): void {
  try {
    localStorage.setItem(HAD_SESSION_KEY, "true");
  } catch {
    /* storage unavailable (private mode) — the message just stays generic */
  }
}

function forgetSession(): void {
  try {
    localStorage.removeItem(HAD_SESSION_KEY);
  } catch {
    /* ignore */
  }
}

function hadSession(): boolean {
  try {
    return localStorage.getItem(HAD_SESSION_KEY) === "true";
  } catch {
    return false;
  }
}

async function errorFrom(response: Response): Promise<APIError> {
  // A 401 means the session is gone: land on the login page (except when
  // already there — the login POST handles its own errors), carrying the
  // current location so signing back in returns to it. Only claim an
  // expired session when this browser actually had one.
  if (
    response.status === 401 &&
    !window.location.pathname.startsWith("/login")
  ) {
    const next = encodeURIComponent(
      window.location.pathname + window.location.search,
    );
    const reason = hadSession() ? "reason=expired&" : "";
    window.location.assign(`/login?${reason}next=${next}`);
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
  const me = (await response.json()) as AuthMe;
  if (me.authenticated) {
    rememberSession();
  }
  return me;
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
  rememberSession();
}

export async function logout(): Promise<void> {
  const response = await fetch("/api/auth/logout", { method: "POST" });
  if (!response.ok && response.status !== 401) {
    throw await errorFrom(response);
  }
  // Deliberate sign-out: a later 401 is not an expiry.
  forgetSession();
}

/** Revokes every session of the current local user (bumps its version). */
export async function logoutEverywhere(): Promise<void> {
  const response = await fetch("/api/auth/logout-all", { method: "POST" });
  if (!response.ok && response.status !== 401) {
    throw await errorFrom(response);
  }
  forgetSession();
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

/** The runtime Prometheus connection, as shown to admins (no secrets). */
export interface AdminDatasource {
  provisioned: boolean;
  editable: boolean;
  configured: boolean;
  url?: string;
  auth?: "none" | "basic" | "bearer";
  username?: string;
  headers?: Record<string, string>;
  caCert?: string;
  clientCert?: string;
  clientKeySet?: boolean;
  insecureSkipVerify?: boolean;
}

/** Datasource edit/test payload; password/token/clientKey are write-only
 * (empty = keep the stored secret). */
export interface DatasourceInput {
  url: string;
  auth: "none" | "basic" | "bearer";
  username?: string;
  password?: string;
  token?: string;
  headers?: Record<string, string>;
  caCert?: string;
  clientCert?: string;
  clientKey?: string;
  insecureSkipVerify?: boolean;
}

export async function adminGetDatasource(): Promise<AdminDatasource> {
  const response = await fetch("/api/admin/datasource");
  if (!response.ok) {
    throw await errorFrom(response);
  }
  return response.json() as Promise<AdminDatasource>;
}

export async function adminPutDatasource(
  input: DatasourceInput,
): Promise<AdminDatasource> {
  const response = await fetch("/api/admin/datasource", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!response.ok) {
    throw await errorFrom(response);
  }
  return response.json() as Promise<AdminDatasource>;
}

/** One snapshot of the git sync loop. */
export interface GitSyncStatus {
  enabled: boolean;
  branch?: string;
  ahead: number;
  behind: number;
  lastSync?: string;
  lastError?: string;
}

/** The git sync configuration, as shown to admins (no secrets). */
export interface AdminGit {
  gitAvailable: boolean;
  commitOnSave: boolean;
  provisioned: boolean;
  editable: boolean;
  enabled: boolean;
  url?: string;
  username?: string;
  auth?: "https" | "ssh";
  sshKeySet?: boolean;
  intervalSeconds?: number;
  status?: GitSyncStatus;
}

/** Git remote edit/test payload; token and sshKey are write-only (empty
 * = keep the stored one, as long as the host is unchanged). */
export interface GitRemoteInput {
  url: string;
  username?: string;
  token?: string;
  sshKey?: string;
  intervalSeconds?: number;
}

export async function adminGetGit(): Promise<AdminGit> {
  const response = await fetch("/api/admin/git");
  if (!response.ok) {
    throw await errorFrom(response);
  }
  return response.json() as Promise<AdminGit>;
}

export async function adminPutGit(input: GitRemoteInput): Promise<AdminGit> {
  const response = await fetch("/api/admin/git", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!response.ok) {
    throw await errorFrom(response);
  }
  return response.json() as Promise<AdminGit>;
}

export async function adminTestGit(
  input: GitRemoteInput,
): Promise<{ reachable: boolean; error?: string }> {
  const response = await fetch("/api/admin/git/test", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!response.ok) {
    throw await errorFrom(response);
  }
  return response.json() as Promise<{ reachable: boolean; error?: string }>;
}

export async function adminSyncGit(): Promise<GitSyncStatus> {
  const response = await fetch("/api/admin/git/sync", { method: "POST" });
  if (!response.ok) {
    throw await errorFrom(response);
  }
  return response.json() as Promise<GitSyncStatus>;
}

export async function adminTestDatasource(
  input: DatasourceInput,
): Promise<{ reachable: boolean; error?: string }> {
  const response = await fetch("/api/admin/datasource/test", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!response.ok) {
    throw await errorFrom(response);
  }
  return response.json() as Promise<{ reachable: boolean; error?: string }>;
}

export interface PrometheusHealth {
  configured: boolean;
  reachable: boolean;
  error?: string;
}

export async function fetchPrometheusHealth(): Promise<PrometheusHealth> {
  const response = await fetch("/api/prometheus/health");
  if (!response.ok) {
    throw await errorFrom(response);
  }
  return response.json() as Promise<PrometheusHealth>;
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

/** Commits touching the dashboard's file, most recent first. */
export async function listHistory(name: string): Promise<HistoryCommit[]> {
  const response = await fetch(`/api/history/${dashboardPath(name)}`);
  if (!response.ok) {
    throw await errorFrom(response);
  }
  return response.json() as Promise<HistoryCommit[]>;
}

/** The dashboard file as it was at a commit (for preview/restore). */
export async function getHistoryVersion(
  name: string,
  hash: string,
): Promise<DashboardFile> {
  const response = await fetch(
    `/api/history/${dashboardPath(name)}?at=${encodeURIComponent(hash)}`,
  );
  if (!response.ok) {
    throw await errorFrom(response);
  }
  const format = (response.headers.get("X-Dashboard-Format") ??
    "yaml") as DashboardFile["format"];
  return { content: await response.text(), format };
}

/** Unified diff from a commit to another (or to the current file). */
export async function getHistoryDiff(
  name: string,
  from: string,
  to?: string,
): Promise<string> {
  const params = new URLSearchParams({ from });
  if (to) {
    params.set("to", to);
  }
  const response = await fetch(
    `/api/history/${dashboardPath(name)}?${params}`,
  );
  if (!response.ok) {
    throw await errorFrom(response);
  }
  const body = (await response.json()) as { diff: string };
  return body.diff;
}

export async function putDashboard(
  name: string,
  content: string,
  format: DashboardFile["format"],
  options: { createOnly?: boolean; commitMessage?: string } = {},
): Promise<void> {
  const headers: Record<string, string> = {
    "Content-Type": CONTENT_TYPES[format],
  };
  if (options.createOnly) {
    // The backend then refuses to overwrite an existing dashboard (409).
    headers["If-None-Match"] = "*";
  }
  if (options.commitMessage) {
    // Subject of the commit-on-save commit, when the server enables it.
    headers["X-Commit-Message"] = options.commitMessage;
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
