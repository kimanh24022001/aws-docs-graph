"use client";

import ForceGraph2D from "react-force-graph-2d";
import type { GraphNode, GraphEdge } from "@/lib/types";

// Deterministic color per service string — uses a simple hash to pick from palette.
const SERVICE_PALETTE = [
  "#4285f4",
  "#ea4335",
  "#fbbc05",
  "#34a853",
  "#ff6d00",
  "#46bdc6",
  "#9c27b0",
  "#e91e63",
  "#00bcd4",
  "#8bc34a",
  "#ff5722",
  "#607d8b",
];

function serviceColor(service: string | null): string {
  if (!service) return "#999";
  let hash = 0;
  for (let i = 0; i < service.length; i++) {
    hash = (hash * 31 + service.charCodeAt(i)) & 0xffffff;
  }
  return SERVICE_PALETTE[Math.abs(hash) % SERVICE_PALETTE.length];
}

interface Props {
  nodes: GraphNode[];
  edges: GraphEdge[];
  onNodeClick?: (node: GraphNode) => void;
  width?: number;
  height?: number;
}

export function GraphCanvas({
  nodes,
  edges,
  onNodeClick,
  width = 900,
  height = 600,
}: Props) {
  const graphData = {
    nodes,
    links: edges.map((e) => ({ ...e, source: e.source, target: e.target })),
  };

  return (
    <ForceGraph2D
      graphData={graphData}
      nodeColor={(node) => serviceColor((node as GraphNode).service)}
      nodeLabel={(node) => (node as GraphNode).title ?? (node as GraphNode).url}
      onNodeClick={(node) => {
        if (onNodeClick) onNodeClick(node as GraphNode);
      }}
      width={width}
      height={height}
    />
  );
}
