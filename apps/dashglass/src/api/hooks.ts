import { useEffect } from "react";

import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";

import {
  deleteDashboard,
  fetchAuthMe,
  fetchCapabilities,
  fetchPrometheusHealth,
  getDashboardFile,
  listDashboards,
  listHistory,
  putDashboard,
  type DashboardFile,
} from "./client";

export function useCapabilities() {
  return useQuery({
    queryKey: ["capabilities"],
    queryFn: fetchCapabilities,
    staleTime: Number.POSITIVE_INFINITY,
  });
}

export function useAuthMe() {
  return useQuery({
    queryKey: ["auth", "me"],
    queryFn: fetchAuthMe,
    staleTime: 60_000,
  });
}

/**
 * Effective permissions for UI gating: roles come from the session (or
 * the anonymous admin while auth is disabled); the provisioned readonly
 * mode wins over any role for dashboard writes (DESIGN.md §7.4).
 */
export function usePermissions() {
  const capabilities = useCapabilities();
  const me = useAuthMe();
  const role = me.data?.role;
  const readonly = capabilities.data?.readonly ?? false;
  const authKind = capabilities.data?.auth?.kind ?? "none";
  return {
    loading: capabilities.isLoading || me.isLoading,
    authEnabled: me.data?.authEnabled ?? false,
    authenticated: me.data?.authenticated ?? false,
    authKind,
    // Reverse-proxy mode: no local login, users are external.
    proxy: me.data?.proxy ?? false,
    // Identity comes from an external provider (proxy or OIDC): no local
    // accounts to manage.
    externalIdentity: authKind === "proxy" || authKind === "oidc",
    username: me.data?.username,
    role,
    canEdit: !readonly && (role === "editor" || role === "admin"),
    isAdmin: role === "admin",
    readonly,
  };
}

export function useDashboards() {
  return useQuery({ queryKey: ["dashboards"], queryFn: listDashboards });
}

/**
 * Prometheus reachability, for the connection banner. Gated on being
 * allowed to call the API (a pre-login 401 would bounce to the login
 * page); polled so a recovered/lost connection is reflected.
 */
export function usePrometheusHealth() {
  const { loading, authEnabled, authenticated } = usePermissions();
  return useQuery({
    queryKey: ["prometheus", "health"],
    queryFn: fetchPrometheusHealth,
    enabled: !loading && (!authEnabled || authenticated),
    staleTime: 15_000,
    refetchInterval: 30_000,
  });
}

export function useDashboardFile(name: string) {
  return useQuery({
    queryKey: ["dashboards", name],
    queryFn: () => getDashboardFile(name),
  });
}

/** Git history of a dashboard file (only fetched while the drawer is open). */
export function useDashboardHistory(name: string, enabled: boolean) {
  return useQuery({
    queryKey: ["dashboards", name, "history"],
    queryFn: () => listHistory(name),
    enabled,
  });
}

export function useSaveDashboard(name: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ content, format }: DashboardFile) =>
      putDashboard(name, content, format),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["dashboards"] });
    },
  });
}

export function useDeleteDashboard() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: deleteDashboard,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["dashboards"] });
    },
  });
}

/**
 * The GitOps loop, client side: dashboard file changes streamed by the
 * backend (SSE) invalidate the query cache, so a `git pull` in the
 * dashboards directory updates open pages live.
 */
export function useDashboardEvents() {
  const queryClient = useQueryClient();
  useEffect(() => {
    const source = new EventSource("/api/events");
    source.onmessage = (event) => {
      const change = JSON.parse(event.data as string) as { name?: string };
      void queryClient.invalidateQueries({ queryKey: ["dashboards"] });
      if (change.name) {
        void queryClient.invalidateQueries({
          queryKey: ["dashboards", change.name],
        });
      }
    };
    return () => source.close();
  }, [queryClient]);
}
