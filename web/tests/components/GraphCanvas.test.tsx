import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { GraphCanvas } from "@/components/GraphCanvas";
import { FIXTURE_GRAPH_OVERVIEW } from "../mocks/fixtures";

describe("GraphCanvas", () => {
  it("renders a canvas element", () => {
    render(
      <GraphCanvas
        nodes={FIXTURE_GRAPH_OVERVIEW.nodes}
        edges={FIXTURE_GRAPH_OVERVIEW.edges}
      />,
    );
    expect(screen.getByTestId("force-graph")).toBeInTheDocument();
  });

  it("passes correct node count to the graph", () => {
    render(
      <GraphCanvas
        nodes={FIXTURE_GRAPH_OVERVIEW.nodes}
        edges={FIXTURE_GRAPH_OVERVIEW.edges}
      />,
    );
    expect(screen.getByTestId("force-graph")).toHaveAttribute(
      "data-node-count",
      String(FIXTURE_GRAPH_OVERVIEW.nodes.length),
    );
  });

  it("calls onNodeClick with node when canvas clicked", () => {
    const onNodeClick = vi.fn();
    render(
      <GraphCanvas
        nodes={FIXTURE_GRAPH_OVERVIEW.nodes}
        edges={FIXTURE_GRAPH_OVERVIEW.edges}
        onNodeClick={onNodeClick}
      />,
    );
    fireEvent.click(screen.getByTestId("force-graph"));
    expect(onNodeClick).toHaveBeenCalledWith(FIXTURE_GRAPH_OVERVIEW.nodes[0]);
  });
});
