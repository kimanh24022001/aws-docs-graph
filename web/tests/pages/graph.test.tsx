import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { http, HttpResponse } from "msw";
import { server } from "../mocks/server";
import GraphPage from "@/app/graph/page";
import { FIXTURE_GRAPH_OVERVIEW } from "../mocks/fixtures";
import type { ReactNode } from "react";

// Mock next/navigation
const mockPush = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush }),
  useParams: () => ({ id: "doc_01" }),
}));

// Mock Supabase
vi.mock("@/lib/supabase", () => ({
  createBrowserClient: () => ({
    auth: {
      getSession: async () => ({
        data: { session: { access_token: "test-token" } },
      }),
    },
  }),
}));

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8080";

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

describe("GraphPage", () => {
  it("shows loading state initially", () => {
    render(<GraphPage />, { wrapper });
    expect(screen.getByText(/loading graph/i)).toBeInTheDocument();
  });

  it("renders node count after data loads", async () => {
    render(<GraphPage />, { wrapper });
    await waitFor(() =>
      expect(screen.getByText(/documents/i)).toBeInTheDocument(),
    );
    expect(screen.getByText(/documents/i).textContent).toContain(
      String(FIXTURE_GRAPH_OVERVIEW.nodes.length),
    );
  });

  it("renders the force graph canvas after data loads", async () => {
    render(<GraphPage />, { wrapper });
    await waitFor(() =>
      expect(screen.getByTestId("force-graph")).toBeInTheDocument(),
    );
  });

  it("navigates to /graph/[id] when a node is clicked", async () => {
    mockPush.mockClear();
    render(<GraphPage />, { wrapper });
    await waitFor(() =>
      expect(screen.getByTestId("force-graph")).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByTestId("force-graph"));
    expect(mockPush).toHaveBeenCalledWith(
      `/graph/${FIXTURE_GRAPH_OVERVIEW.nodes[0].id}`,
    );
  });

  it("shows error state when API fails", async () => {
    server.use(
      http.get(`${API_BASE}/v1/graph/overview`, () =>
        HttpResponse.json({ error: "server error" }, { status: 500 }),
      ),
    );
    render(<GraphPage />, { wrapper });
    await waitFor(() =>
      expect(screen.getByText(/failed to load graph/i)).toBeInTheDocument(),
    );
  });
});
