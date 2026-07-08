import type { GraphNode } from "@/lib/types";

interface Props {
  node: GraphNode;
}

export function NodeDetailPanel({ node }: Props) {
  return (
    <div
      style={{
        padding: 16,
        background: "#fff",
        border: "1px solid #e8e8e8",
        borderRadius: 6,
      }}
    >
      <h3 style={{ margin: "0 0 8px", fontSize: 16 }}>
        {node.title ?? node.url}
      </h3>
      {node.service && (
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
          {node.service}
        </span>
      )}
      <p style={{ margin: 0, fontSize: 13 }}>
        <a
          href={node.url}
          target="_blank"
          rel="noreferrer"
          style={{ color: "#0070f3" }}
        >
          {node.url}
        </a>
      </p>
    </div>
  );
}
