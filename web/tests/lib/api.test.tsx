import { describe, it, expect } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  useMe,
  useQueryHistory,
  useSubmitQuery,
  useQueryDetail,
} from "@/lib/api";
import {
  FIXTURE_ME,
  FIXTURE_QUERY_HISTORY,
  FIXTURE_QUERY_RESPONSE,
} from "../mocks/fixtures";
import type { ReactNode } from "react";

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

describe("useMe", () => {
  it("fetches /v1/me and returns user data", async () => {
    const { result } = renderHook(() => useMe(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(FIXTURE_ME);
  });
});

describe("useQueryHistory", () => {
  it("fetches /v1/queries and returns query list", async () => {
    const { result } = renderHook(() => useQueryHistory(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.queries).toHaveLength(1);
    expect(result.current.data?.queries[0].id).toBe(FIXTURE_QUERY_RESPONSE.id);
  });
});

describe("useQueryDetail", () => {
  it("fetches /v1/queries/:id and returns query", async () => {
    const { result } = renderHook(
      () => useQueryDetail(FIXTURE_QUERY_RESPONSE.id),
      { wrapper },
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.question).toBe(FIXTURE_QUERY_RESPONSE.question);
  });
});

describe("useSubmitQuery", () => {
  it("posts to /v1/queries and returns QueryResponse", async () => {
    const { result } = renderHook(() => useSubmitQuery(), { wrapper });
    act(() => {
      result.current.mutate({ question: "How do I tag ECS resources?" });
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.answer).toContain("tag");
  });
});
