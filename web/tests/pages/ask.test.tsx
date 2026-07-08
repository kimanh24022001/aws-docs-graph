import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { http, HttpResponse } from "msw";
import { server } from "../mocks/server";
import AskPage from "@/app/ask/page";
import {
  FIXTURE_QUERY_RESPONSE,
  FIXTURE_QUERY_MCP_DOWN,
  FIXTURE_QUERY_NEO4J_DOWN,
  FIXTURE_QUERY_SYNTHESIS_FAILED,
} from "../mocks/fixtures";
import type { ReactNode } from "react";

// Mock Supabase — tests don't need real auth
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

describe("AskPage — happy path", () => {
  it("renders the question form", () => {
    render(<AskPage />, { wrapper });
    expect(screen.getByRole("textbox")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /ask/i })).toBeInTheDocument();
  });

  it("shows answer and citations after submitting a question", async () => {
    render(<AskPage />, { wrapper });
    await userEvent.type(
      screen.getByRole("textbox"),
      "How do I tag ECS resources?",
    );
    await userEvent.click(screen.getByRole("button", { name: /ask/i }));
    await waitFor(() =>
      expect(screen.getByText(/To tag ECS resources/)).toBeInTheDocument(),
    );
    expect(
      screen.getByText("Tagging Amazon ECS resources"),
    ).toBeInTheDocument();
    expect(screen.getByText("AWS Cost Explorer")).toBeInTheDocument();
  });

  it("shows no degraded banner on success", async () => {
    render(<AskPage />, { wrapper });
    await userEvent.type(
      screen.getByRole("textbox"),
      "How do I tag ECS resources?",
    );
    await userEvent.click(screen.getByRole("button", { name: /ask/i }));
    await waitFor(() =>
      expect(screen.getByText(/To tag ECS resources/)).toBeInTheDocument(),
    );
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});

describe("AskPage — degraded banners", () => {
  it("shows MCP unavailable banner when mcp_unavailable=true", async () => {
    server.use(
      http.post(`${API_BASE}/v1/queries`, () =>
        HttpResponse.json(FIXTURE_QUERY_MCP_DOWN),
      ),
    );
    render(<AskPage />, { wrapper });
    await userEvent.type(screen.getByRole("textbox"), "anything");
    await userEvent.click(screen.getByRole("button", { name: /ask/i }));
    await waitFor(() =>
      expect(
        screen.getByText(
          "AWS docs search unavailable — showing related docs from our graph.",
        ),
      ).toBeInTheDocument(),
    );
  });

  it("shows Neo4j unavailable banner when neo4j_unavailable=true", async () => {
    server.use(
      http.post(`${API_BASE}/v1/queries`, () =>
        HttpResponse.json(FIXTURE_QUERY_NEO4J_DOWN),
      ),
    );
    render(<AskPage />, { wrapper });
    await userEvent.type(screen.getByRole("textbox"), "anything");
    await userEvent.click(screen.getByRole("button", { name: /ask/i }));
    await waitFor(() =>
      expect(
        screen.getByText("Related-doc suggestions temporarily unavailable."),
      ).toBeInTheDocument(),
    );
  });

  it("shows synthesis failed banner when synthesis_failed=true", async () => {
    server.use(
      http.post(`${API_BASE}/v1/queries`, () =>
        HttpResponse.json(FIXTURE_QUERY_SYNTHESIS_FAILED),
      ),
    );
    render(<AskPage />, { wrapper });
    await userEvent.type(screen.getByRole("textbox"), "anything");
    await userEvent.click(screen.getByRole("button", { name: /ask/i }));
    await waitFor(() =>
      expect(
        screen.getByText(
          "Couldn't generate written answer; here are the most relevant pages.",
        ),
      ).toBeInTheDocument(),
    );
  });
});

describe("AskPage — error state", () => {
  it("shows error message when API returns 500", async () => {
    server.use(
      http.post(`${API_BASE}/v1/queries`, () =>
        HttpResponse.json({ error: "internal server error" }, { status: 500 }),
      ),
    );
    render(<AskPage />, { wrapper });
    await userEvent.type(screen.getByRole("textbox"), "anything");
    await userEvent.click(screen.getByRole("button", { name: /ask/i }));
    await waitFor(() =>
      expect(screen.getByText(/something went wrong/i)).toBeInTheDocument(),
    );
  });
});
