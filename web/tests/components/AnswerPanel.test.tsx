import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { AnswerPanel } from "@/components/AnswerPanel";

describe("AnswerPanel", () => {
  it("renders answer text", () => {
    render(
      <AnswerPanel
        answer="To tag ECS resources [1], activate in Billing [2]."
        citationCount={2}
      />,
    );
    expect(screen.getByText(/To tag ECS resources/)).toBeInTheDocument();
  });

  it("renders inline citation markers as superscript links", () => {
    render(
      <AnswerPanel
        answer="See tagging docs [1] for details."
        citationCount={1}
      />,
    );
    const link = screen.getByRole("link", { name: "[1]" });
    expect(link).toBeInTheDocument();
    expect(link).toHaveAttribute("href", "#citation-1");
  });

  it("renders null-state message when answer is null", () => {
    render(<AnswerPanel answer={null} citationCount={0} />);
    expect(
      screen.getByText("No written answer available."),
    ).toBeInTheDocument();
  });
});
