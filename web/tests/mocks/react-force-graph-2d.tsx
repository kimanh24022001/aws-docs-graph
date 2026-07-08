import { forwardRef } from "react";
import type { GraphNode, GraphEdge } from "@/lib/types";

interface MockProps {
  graphData?: { nodes: GraphNode[]; links: GraphEdge[] };
  nodeColor?: (node: GraphNode) => string;
  onNodeClick?: (node: GraphNode) => void;
  width?: number;
  height?: number;
}

const ForceGraph2D = forwardRef<HTMLCanvasElement, MockProps>(
  ({ graphData, onNodeClick }, ref) => (
    <canvas
      ref={ref}
      data-testid="force-graph"
      data-node-count={graphData?.nodes.length ?? 0}
      onClick={() => {
        if (onNodeClick && graphData?.nodes[0]) {
          onNodeClick(graphData.nodes[0]);
        }
      }}
    />
  ),
);

ForceGraph2D.displayName = "ForceGraph2D";
export default ForceGraph2D;
