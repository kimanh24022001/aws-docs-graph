import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { CitationsPanel } from "@/components/CitationsPanel";
import { FIXTURE_QUERY_RESPONSE } from "../mocks/fixtures";

describe("CitationsPanel", () => {
  it("renders all citations", () => {
    render(<CitationsPanel citations={FIXTURE_QUERY_RESPONSE.citations} />);
    expect(
      screen.getByText("Tagging Amazon ECS resources"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Activating user-defined cost allocation tags"),
    ).toBeInTheDocument();
  });

  it("renders title as external link", () => {
    render(<CitationsPanel citations={FIXTURE_QUERY_RESPONSE.citations} />);
    const link = screen.getByRole("link", {
      name: "Tagging Amazon ECS resources",
    });
    expect(link).toHaveAttribute(
      "href",
      "https://docs.aws.amazon.com/AmazonECS/latest/developerguide/ecs-using-tags.html",
    );
    expect(link).toHaveAttribute("target", "_blank");
  });

  it("renders service badge", () => {
    render(<CitationsPanel citations={FIXTURE_QUERY_RESPONSE.citations} />);
    expect(screen.getByText("ECS")).toBeInTheDocument();
  });

  it("renders anchor id for each citation", () => {
    render(<CitationsPanel citations={FIXTURE_QUERY_RESPONSE.citations} />);
    expect(document.getElementById("citation-1")).toBeInTheDocument();
  });

  it("renders snippet text", () => {
    render(<CitationsPanel citations={FIXTURE_QUERY_RESPONSE.citations} />);
    expect(
      screen.getByText(/You can tag most Amazon ECS resources/),
    ).toBeInTheDocument();
  });

  it("renders empty state when no citations", () => {
    render(<CitationsPanel citations={[]} />);
    expect(screen.getByText("No citations available.")).toBeInTheDocument();
  });
});
