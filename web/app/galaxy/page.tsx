"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import { useQuery } from "@tanstack/react-query";
import { fetchClusters, fetchGraphOverview } from "@/lib/api";
import { categoryFor, categoryColor } from "@/lib/categories";
import type { GalaxyCluster, GraphNode } from "@/lib/types";

const ForceGraph2D = dynamic(() => import("react-force-graph-2d"), {
  ssr: false,
  loading: () => <div style={{ padding: 32 }}>Loading galaxy…</div>,
});

type View = { level: "categories" } | { level: "category"; category: string };

export default function GalaxyPage() {
  const [view, setView] = useState<View>({ level: "categories" });

  const clustersQ = useQuery({
    queryKey: ["galaxy", "clusters"],
    queryFn: fetchClusters,
    staleTime: 60 * 60 * 1000,
  });

  const overviewQ = useQuery({
    queryKey: ["graph", "overview"],
    queryFn: fetchGraphOverview,
    enabled: view.level === "category",
    staleTime: 24 * 60 * 60 * 1000,
  });

  const width = typeof window !== "undefined" ? window.innerWidth : 1200;
  const height = typeof window !== "undefined" ? window.innerHeight - 80 : 700;

  // Level 0: category planets
  if (view.level === "categories") {
    const cats = (clustersQ.data?.clusters ?? []).filter(
      (c: GalaxyCluster) => c.label !== "Other",
    );
    const graphData = {
      nodes: cats.map((c: GalaxyCluster) => ({
        id: c.id,
        label: `${c.label} (${c.nodeCount})`,
        category: c.label,
        val: Math.sqrt(c.nodeCount) * 2,
        color: categoryColor(c.label),
      })),
      links: [],
    };

    return (
      <main>
        <div style={{ padding: "16px 24px", borderBottom: "1px solid #eee" }}>
          <h1 style={{ fontSize: 22, margin: 0 }}>🌌 AWS Galaxy</h1>
          <p style={{ color: "#888", fontSize: 14, margin: "4px 0 0" }}>
            {cats.length} categories · click a planet to explore
          </p>
        </div>
        {clustersQ.isLoading ? (
          <div style={{ padding: 32 }}>Loading categories…</div>
        ) : (
          <ForceGraph2D
            graphData={graphData}
            nodeVal={(n) => (n as { val: number }).val}
            nodeColor={(n) => (n as { color: string }).color}
            nodeLabel={(n) => (n as { label: string }).label}
            onNodeClick={(n) => {
              const node = n as { category: string };
              setView({ level: "category", category: node.category });
            }}
            width={width}
            height={height}
          />
        )}
      </main>
    );
  }

  // Level 1: docs in this category
  const allNodes = overviewQ.data?.nodes ?? [];
  const allEdges = overviewQ.data?.edges ?? [];
  const catNodes = allNodes.filter(
    (n) => categoryFor(n.service) === view.category,
  );
  const nodeIds = new Set(catNodes.map((n) => n.id));
  const links = allEdges
    .filter((e) => nodeIds.has(e.source) && nodeIds.has(e.target))
    .map((e) => ({ source: e.source, target: e.target }));

  return (
    <main>
      <div style={{ padding: "16px 24px", borderBottom: "1px solid #eee" }}>
        <button
          onClick={() => setView({ level: "categories" })}
          style={{
            padding: "6px 14px",
            background: "#fff",
            border: "1px solid #ddd",
            borderRadius: 6,
            cursor: "pointer",
            fontSize: 13,
            marginRight: 12,
          }}
        >
          ← Back to galaxy
        </button>
        <span style={{ fontSize: 16, fontWeight: 600 }}>{view.category}</span>
        <span style={{ color: "#888", fontSize: 14, marginLeft: 8 }}>
          {catNodes.length} documents
        </span>
      </div>
      {overviewQ.isLoading ? (
        <div style={{ padding: 32 }}>Loading documents…</div>
      ) : (
        <ForceGraph2D
          graphData={{ nodes: catNodes, links }}
          nodeColor={(n) =>
            categoryColor(categoryFor((n as GraphNode).service))
          }
          nodeLabel={(n) => (n as GraphNode).title ?? (n as GraphNode).url}
          width={width}
          height={height}
        />
      )}
    </main>
  );
}
