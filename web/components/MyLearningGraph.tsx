"use client";

import dynamic from "next/dynamic";
import { useMemo } from "react";
import { categoryColor, categoryFor } from "@/lib/categories";
import type { MyLearningNode, MyLearningEdge } from "@/lib/types";

const ForceGraph2D = dynamic(() => import("react-force-graph-2d"), {
  ssr: false,
  loading: () => (
    <div style={{ color: "#555", padding: 40, textAlign: "center" }}>
      Loading graph…
    </div>
  ),
});

interface Props {
  nodes: MyLearningNode[];
  edges: MyLearningEdge[];
}

interface FGNode {
  id: string;
  label: string;
  service: string;
  visitCount: number;
  url: string;
  color: string;
  val: number;
}

interface FGLink {
  source: string;
  target: string;
  weight: number;
}

export function MyLearningGraph({ nodes, edges }: Props) {
  const graphData = useMemo(() => {
    const fgNodes: FGNode[] = nodes.map((n) => ({
      id: n.id,
      label: n.title || n.url,
      service: n.service,
      visitCount: n.visitCount,
      url: n.url,
      color: categoryColor(categoryFor(n.service.toLowerCase())),
      val: 4 + Math.log(n.visitCount + 1) * 4,
    }));

    const fgLinks: FGLink[] = edges.map((e) => ({
      source: e.source,
      target: e.target,
      weight: e.weight,
    }));

    return { nodes: fgNodes, links: fgLinks };
  }, [nodes, edges]);

  return (
    <ForceGraph2D
      graphData={graphData}
      backgroundColor="#0a0a1a"
      nodeColor={(n) => (n as FGNode).color}
      nodeVal={(n) => (n as FGNode).val}
      nodeLabel={(n) => (n as FGNode).label}
      linkColor={() => "rgba(255,255,255,0.25)"}
      linkWidth={(l) => Math.max(0.5, (l as FGLink).weight * 0.8)}
      onNodeClick={(node) => {
        const n = node as FGNode;
        if (n.url) window.open(n.url, "_blank");
      }}
      onNodeHover={(node) => {
        document.body.style.cursor = node ? "pointer" : "default";
      }}
      width={typeof window !== "undefined" ? window.innerWidth : 1200}
      height={typeof window !== "undefined" ? window.innerHeight : 800}
    />
  );
}
