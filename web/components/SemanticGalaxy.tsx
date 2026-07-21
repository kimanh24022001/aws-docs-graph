"use client";

import dynamic from "next/dynamic";
import { useCallback } from "react";
import { useGalaxyState } from "./galaxy/useGalaxyState";
import { useGalaxyData } from "./galaxy/useGalaxyData";
import { gravityToNodeSize } from "./galaxy/gravityUtils";
import { LEVEL_FORCE_CONFIG } from "./galaxy/galaxyForceConfig";
import type { GraphNode } from "@/lib/types";

const ForceGraph2D = dynamic(() => import("react-force-graph-2d"), {
  ssr: false,
  loading: () => <div style={{ padding: 32 }}>Loading graph...</div>,
});

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
  width?: number;
  height?: number;
  onNodeNavigate?: (nodeId: string) => void;
}

export function SemanticGalaxy({
  width = 1200,
  height = 700,
  onNodeNavigate,
}: Props) {
  const { current, push, pop, canGoBack } = useGalaxyState();
  const { nodes, edges, isLoading, isError } = useGalaxyData(current);

  const forceConfig =
    LEVEL_FORCE_CONFIG[
      current.type === "gravity"
        ? "gravity"
        : current.type === "overview"
          ? "universe"
          : "cluster"
    ];

  const focalNodeId = current.type === "gravity" ? current.focalNodeId : null;

  const handleNodeClick = useCallback(
    (node: object) => {
      const n = node as GraphNode;
      if (!n.id) return;
      // Single click: activate gravity
      push({ type: "gravity", focalNodeId: n.id });
    },
    [push],
  );

  const handleBackgroundClick = useCallback(() => {
    if (current.type === "gravity") pop();
  }, [current, pop]);

  const nodeVal = useCallback(
    (node: object) => {
      const n = node as GraphNode;
      if (focalNodeId) {
        return gravityToNodeSize(0.5, n.id === focalNodeId);
      }
      return 4;
    },
    [focalNodeId],
  );

  const nodeColor = useCallback(
    (node: object) => {
      const n = node as GraphNode;
      const base = serviceColor(n.service);
      if (!focalNodeId) return base;
      // Dim non-focal nodes via hex alpha
      if (n.id === focalNodeId) return base;
      return base + "66"; // ~40% opacity
    },
    [focalNodeId],
  );

  if (isLoading) return <div style={{ padding: 32 }}>Loading galaxy...</div>;
  if (isError)
    return (
      <div style={{ padding: 32, color: "#c00" }}>Failed to load graph.</div>
    );

  const nodeIds = new Set(nodes.map((n) => n.id));
  const validLinks = edges
    .map((e) => {
      const src = nodeIds.has(e.source) ? e.source : null;
      const tgt = nodeIds.has(e.target) ? e.target : null;
      if (!src || !tgt) return null;
      return { source: src, target: tgt };
    })
    .filter(Boolean);

  return (
    <div style={{ position: "relative" }}>
      {canGoBack && (
        <button
          onClick={pop}
          style={{
            position: "absolute",
            top: 16,
            left: 16,
            zIndex: 10,
            padding: "6px 14px",
            background: "#fff",
            border: "1px solid #ddd",
            borderRadius: 6,
            cursor: "pointer",
            fontSize: 13,
          }}
        >
          ← Back
        </button>
      )}
      <ForceGraph2D
        graphData={{ nodes, links: validLinks }}
        nodeColor={nodeColor}
        nodeVal={nodeVal}
        nodeLabel={(node) => {
          const n = node as GraphNode;
          return n.title ?? n.url ?? n.id;
        }}
        onNodeClick={handleNodeClick}
        onBackgroundClick={handleBackgroundClick}
        d3VelocityDecay={0.3}
        width={width}
        height={height}
      />
    </div>
  );
}
