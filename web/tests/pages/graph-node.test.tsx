import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import GraphNodePage from "@/app/graph/[id]/page";
import {
  FIXTURE_DOCUMENT,
  FIXTURE_DOCUMENT_NEIGHBORS,
} from "../mocks/fixtures";
import type { ReactNode } from "react";

// Mock next/navigation — always return doc_01 as the active id
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
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

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

describe("GraphNodePage", () => {
  it("shows loading state initially", () => {
    render(<GraphNodePage />, { wrapper });
    expect(screen.getByText(/loading/i)).toBeInTheDocument();
  });

  it("renders document title after data loads", async () => {
    render(<GraphNodePage />, { wrapper });
    await waitFor(() =>
      expect(screen.getByText(FIXTURE_DOCUMENT.title!)).toBeInTheDocument(),
    );
  });

  it("renders document service badge", async () => {
    render(<GraphNodePage />, { wrapper });
    await waitFor(() =>
      expect(screen.getByText(FIXTURE_DOCUMENT.service!)).toBeInTheDocument(),
    );
  });

  it("renders document word count", async () => {
    render(<GraphNodePage />, { wrapper });
    await waitFor(() =>
      expect(
        screen.getByText(
          `${FIXTURE_DOCUMENT.wordCount!.toLocaleString()} words`,
        ),
      ).toBeInTheDocument(),
    );
  });

  it("renders neighbor links in the sidebar", async () => {
    render(<GraphNodePage />, { wrapper });
    await waitFor(() =>
      expect(
        screen.getByText(FIXTURE_DOCUMENT_NEIGHBORS[0].title!),
      ).toBeInTheDocument(),
    );
  });

  it("renders neighbor count", async () => {
    render(<GraphNodePage />, { wrapper });
    await waitFor(() =>
      expect(
        screen.getByText(`Neighbors (${FIXTURE_DOCUMENT_NEIGHBORS.length})`),
      ).toBeInTheDocument(),
    );
  });

  it("renders the force graph canvas", async () => {
    render(<GraphNodePage />, { wrapper });
    await waitFor(() =>
      expect(screen.getByTestId("force-graph")).toBeInTheDocument(),
    );
  });

  it("graph includes center node + neighbor nodes", async () => {
    render(<GraphNodePage />, { wrapper });
    await waitFor(() =>
      expect(screen.getByTestId("force-graph")).toHaveAttribute(
        "data-node-count",
        // 1 center + number of neighbors
        String(1 + FIXTURE_DOCUMENT_NEIGHBORS.length),
      ),
    );
  });
});
