import { QueryClient, useMutation, useQuery } from "@tanstack/react-query";
import { v4 as uuidv4 } from "uuid";
import { createBrowserClient } from "./supabase";
import type {
  QueryResponse,
  QueryHistoryResponse,
  MeResponse,
  GraphOverviewResponse,
} from "./types";

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 30_000, retry: 1 },
  },
});

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "";

async function getAuthHeader(): Promise<string> {
  try {
    const supabase = createBrowserClient();
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session?.access_token) return "";
    return `Bearer ${session.access_token}`;
  } catch {
    return "";
  }
}

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const auth = await getAuthHeader();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(init?.headers as Record<string, string>),
  };
  if (auth) {
    headers["Authorization"] = auth;
  }
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers,
  });
  if (!res.ok) {
    throw new Error(`API ${res.status}`);
  }
  return res.json() as Promise<T>;
}

// ---- Mutations ----

export function useSubmitQuery() {
  return useMutation({
    mutationFn: (payload: { question: string }) =>
      apiFetch<QueryResponse>("/v1/queries", {
        method: "POST",
        headers: { "Idempotency-Key": uuidv4() },
        body: JSON.stringify(payload),
      }),
  });
}

// ---- Queries ----

export function useQueryDetail(id: string) {
  return useQuery({
    queryKey: ["queries", id],
    queryFn: () => apiFetch<QueryResponse>(`/v1/queries/${id}`),
    enabled: Boolean(id),
  });
}

export function useQueryHistory(cursor?: string) {
  return useQuery({
    queryKey: ["queries", "history", cursor],
    queryFn: () =>
      apiFetch<QueryHistoryResponse>(
        cursor ? `/v1/queries?cursor=${cursor}` : "/v1/queries",
      ),
  });
}

export function useMe() {
  return useQuery({
    queryKey: ["me"],
    queryFn: () => apiFetch<MeResponse>("/v1/me"),
  });
}

export function useGraphOverview() {
  return useQuery({
    queryKey: ["graph", "overview"],
    queryFn: () => apiFetch<GraphOverviewResponse>("/v1/graph/overview"),
    staleTime: 24 * 60 * 60 * 1000, // 24h — matches server cache
  });
}
