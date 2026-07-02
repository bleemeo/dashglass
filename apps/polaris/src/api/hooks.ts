import { useEffect } from "react";

import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";

import {
  deleteDashboard,
  fetchCapabilities,
  getDashboardFile,
  listDashboards,
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

export function useDashboards() {
  return useQuery({ queryKey: ["dashboards"], queryFn: listDashboards });
}

export function useDashboardFile(name: string) {
  return useQuery({
    queryKey: ["dashboards", name],
    queryFn: () => getDashboardFile(name),
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
