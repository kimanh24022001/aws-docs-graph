"use client";

import { useParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { GraphCanvas } from "@/components/GraphCanvas";
import { fetchDocument, fetchDocumentNeighbors } from "@/lib/api";
import type { GraphEdge, GraphNode } from "@/lib/types";

export default function GraphNodePage() {
  const { id } = useParams<{ id: string }>();

  const { data: doc, isLoading: docLoading } = useQuery({
    queryKey: ["graph", "document", id],
    queryFn: () => fetchDocument(id),
    enabled: Boolean(id),
  });

  const { data: neighbors, isLoading: neighborsLoading } = useQuery({
    queryKey: ["graph", "neighbors", id],
    queryFn: () => fetchDocumentNeighbors(id),
    enabled: Boolean(id),
  });

  const isLoading = docLoading || neighborsLoading;

  const centerNode: GraphNode = {
    id,
    url: doc?.url ?? "",
    title: doc?.title ?? id,
    service: doc?.service ?? null,
  };

  const neighborNodes: GraphNode[] = (neighbors ?? []).map((n) => ({
    id: n.id,
    url: n.url,
    title: n.title,
    service: n.service,
  }));

  const graphNodes: GraphNode[] = [centerNode, ...neighborNodes];
  const graphEdges: GraphEdge[] = neighborNodes.map((n) => ({
    source: id,
    target: n.id,
    type: "LINKS_TO" as const,
  }));

  return (
    <div style={{ display: "flex", height: "100vh", overflow: "hidden" }}>
      {/* Sidebar */}
      <div
        style={{
          width: 280,
          borderRight: "1px solid #e8e8e8",
          overflowY: "auto",
          padding: 16,
          flexShrink: 0,
        }}
      >
        {isLoading ? (
          <p style={{ color: "#888" }}>Loading...</p>
        ) : (
          <>
            <h2 style={{ fontSize: 16, fontWeight: 700, margin: "0 0 8px" }}>
              {doc?.title ?? id}
            </h2>
            {doc?.service && (
              <span
                style={{
                  display: "inline-block",
                  background: "#e8f0fe",
                  color: "#1a73e8",
                  borderRadius: 3,
                  padding: "1px 6px",
                  fontSize: 12,
                  marginBottom: 8,
                }}
              >
                {doc.service}
              </span>
            )}
            {doc?.url && (
              <p style={{ margin: "0 0 8px", fontSize: 13 }}>
                <a
                  href={doc.url}
                  target="_blank"
                  rel="noreferrer"
                  style={{ color: "#0070f3", wordBreak: "break-all" }}
                >
                  {doc.url}
                </a>
              </p>
            )}
            {doc?.wordCount != null && (
              <p style={{ margin: "0 0 12px", fontSize: 13, color: "#666" }}>
                {doc.wordCount.toLocaleString()} words
              </p>
            )}
            <h3 style={{ fontSize: 14, fontWeight: 600, margin: "0 0 6px" }}>
              Neighbors ({neighbors?.length ?? 0})
            </h3>
            {(neighbors ?? []).map((n) => (
              <a
                key={n.id}
                href={`/graph/${n.id}`}
                style={{
                  display: "block",
                  fontSize: 13,
                  color: "#0070f3",
                  marginBottom: 4,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
                title={n.title ?? n.url}
              >
                {n.title ?? n.url}
              </a>
            ))}
          </>
        )}
      </div>

      {/* Graph canvas */}
      <div style={{ flex: 1, overflow: "hidden" }}>
        {!isLoading && (
          <GraphCanvas
            nodes={graphNodes}
            edges={graphEdges}
            width={
              typeof window !== "undefined" ? window.innerWidth - 280 : 900
            }
            height={typeof window !== "undefined" ? window.innerHeight : 800}
          />
        )}
      </div>
    </div>
  );
}
