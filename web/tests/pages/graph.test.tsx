import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { http, HttpResponse } from "msw";
import { server } from "../mocks/server";
import GraphPage from "@/app/graph/page";
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
    expect(screen.getByText(/loading galaxy/i)).toBeInTheDocument();
  });

  it("renders the force graph canvas after data loads", async () => {
    render(<GraphPage />, { wrapper });
    await waitFor(() =>
      expect(screen.getByTestId("force-graph")).toBeInTheDocument(),
    );
  });

  it("renders the page heading", async () => {
    render(<GraphPage />, { wrapper });
    expect(screen.getByText(/AWS Docs Galaxy/i)).toBeInTheDocument();
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

  it("activates gravity mode when a node is clicked", async () => {
    render(<GraphPage />, { wrapper });
    await waitFor(() =>
      expect(screen.getByTestId("force-graph")).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByTestId("force-graph"));
    // After click, gravity mode loads the focus subgraph — back button appears
    await waitFor(() => expect(screen.getByText(/← Back/)).toBeInTheDocument());
  });
});
