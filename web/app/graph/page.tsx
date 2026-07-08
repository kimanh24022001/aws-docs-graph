"use client";

import { useRouter } from "next/navigation";
import { GraphCanvas } from "@/components/GraphCanvas";
import { useGraphOverview } from "@/lib/api";
import type { GraphNode } from "@/lib/types";

export default function GraphPage() {
  const router = useRouter();
  const { data, isLoading, isError } = useGraphOverview();

  if (isLoading)
    return (
      <main style={{ padding: 32 }}>
        <p>Loading graph...</p>
      </main>
    );
  if (isError)
    return (
      <main style={{ padding: 32 }}>
        <p style={{ color: "#c00" }}>Failed to load graph.</p>
      </main>
    );

  function handleNodeClick(node: GraphNode) {
    router.push(`/graph/${node.id}`);
  }

  return (
    <main>
      <div style={{ padding: "16px 24px", borderBottom: "1px solid #eee" }}>
        <h1 style={{ fontSize: 22, margin: 0 }}>AWS Docs Graph</h1>
        <p style={{ color: "#888", fontSize: 14, margin: "4px 0 0" }}>
          {data?.nodes.length ?? 0} documents &middot; click a node to explore
        </p>
      </div>
      {data && (
        <GraphCanvas
          nodes={data.nodes}
          edges={data.edges}
          onNodeClick={handleNodeClick}
          width={typeof window !== "undefined" ? window.innerWidth : 1200}
          height={typeof window !== "undefined" ? window.innerHeight - 80 : 700}
        />
      )}
    </main>
  );
}
