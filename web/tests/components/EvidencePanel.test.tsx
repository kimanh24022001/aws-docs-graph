import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { EvidencePanel } from "@/components/EvidencePanel";

describe("EvidencePanel", () => {
  it("shows loading state initially", () => {
    render(
      <EvidencePanel
        src="lambda"
        tgt="dynamodb"
        relType="TRIGGERS"
        color="#ef5350"
        onClose={() => {}}
      />,
    );
    expect(screen.getByText(/Loading evidence/)).toBeInTheDocument();
  });

  it("renders evidence text, source title, and confidence after load", async () => {
    render(
      <EvidencePanel
        src="lambda"
        tgt="dynamodb"
        relType="TRIGGERS"
        color="#ef5350"
        onClose={() => {}}
      />,
    );
    await waitFor(() =>
      expect(
        screen.getByText(/Lambda functions can write to DynamoDB/),
      ).toBeInTheDocument(),
    );
    expect(screen.getByText("Using Lambda with DynamoDB")).toBeInTheDocument();
    expect(screen.getByText("92%")).toBeInTheDocument();
  });

  it("renders the relationship header with src, relType, tgt", async () => {
    render(
      <EvidencePanel
        src="lambda"
        tgt="dynamodb"
        relType="TRIGGERS"
        color="#ef5350"
        onClose={() => {}}
      />,
    );
    await waitFor(() => expect(screen.getByText("LAMBDA")).toBeInTheDocument());
    expect(screen.getByText("DYNAMODB")).toBeInTheDocument();
    expect(screen.getByText("TRIGGERS")).toBeInTheDocument();
  });

  it("calls onClose when close button is clicked", async () => {
    const onClose = vi.fn();
    render(
      <EvidencePanel
        src="lambda"
        tgt="dynamodb"
        relType="TRIGGERS"
        color="#ef5350"
        onClose={onClose}
      />,
    );
    fireEvent.click(screen.getByRole("button"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("shows fallback content when evidence array is empty", async () => {
    // Override handler to return empty evidence for this test
    const { server } = await import("../mocks/server");
    const { http, HttpResponse } = await import("msw");
    const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8080";
    server.use(
      http.get(`${API_BASE}/v1/graph/evidence`, () =>
        HttpResponse.json({
          src: "s3",
          tgt: "ec2",
          rel_type: "INTEGRATES_WITH",
          evidence: [],
        }),
      ),
    );
    render(
      <EvidencePanel
        src="s3"
        tgt="ec2"
        relType="INTEGRATES_WITH"
        color="#4fc3f7"
        onClose={() => {}}
      />,
    );
    await waitFor(() =>
      expect(
        screen.getByText(/Detected from document pattern/),
      ).toBeInTheDocument(),
    );
    expect(screen.getByText("60%")).toBeInTheDocument();
    expect(screen.getByText(/Rule-based/)).toBeInTheDocument();
  });
});
