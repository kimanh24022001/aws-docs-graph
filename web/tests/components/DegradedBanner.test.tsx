import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { DegradedBanner } from "@/components/DegradedBanner";

describe("DegradedBanner", () => {
  it("shows MCP unavailable message", () => {
    render(<DegradedBanner variant="mcp_unavailable" />);
    expect(
      screen.getByText(
        "AWS docs search unavailable — showing related docs from our graph.",
      ),
    ).toBeInTheDocument();
  });

  it("shows Neo4j unavailable message", () => {
    render(<DegradedBanner variant="neo4j_unavailable" />);
    expect(
      screen.getByText("Related-doc suggestions temporarily unavailable."),
    ).toBeInTheDocument();
  });

  it("shows synthesis failed message", () => {
    render(<DegradedBanner variant="synthesis_failed" />);
    expect(
      screen.getByText(
        "Couldn't generate written answer; here are the most relevant pages.",
      ),
    ).toBeInTheDocument();
  });

  it("renders nothing when variant is undefined", () => {
    const { container } = render(<DegradedBanner variant={undefined} />);
    expect(container).toBeEmptyDOMElement();
  });
});
