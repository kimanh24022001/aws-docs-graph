import type { RelatedDoc } from "@/lib/types";

interface Props {
  relatedDocs: RelatedDoc[];
}

export function RelatedDocsPanel({ relatedDocs }: Props) {
  if (relatedDocs.length === 0) {
    return <p style={{ color: "#666" }}>No related docs found.</p>;
  }
  return (
    <ul style={{ paddingLeft: 20, margin: 0 }}>
      {relatedDocs.map((doc) => (
        <li key={doc.url} style={{ marginBottom: 10 }}>
          <a
            href={doc.url}
            target="_blank"
            rel="noreferrer"
            style={{ fontWeight: 600, color: "#0070f3" }}
          >
            {doc.title}
          </a>{" "}
          <span
            style={{
              display: "inline-block",
              background: "#e8f0fe",
              color: "#1a73e8",
              borderRadius: 3,
              padding: "1px 6px",
              fontSize: 12,
              marginLeft: 4,
            }}
          >
            {doc.service}
          </span>
          <span style={{ color: "#888", fontSize: 13, marginLeft: 8 }}>
            {doc.hop_count} hop{doc.hop_count !== 1 ? "s" : ""}
          </span>
          {doc.edge_path.length > 0 && (
            <span style={{ color: "#aaa", fontSize: 12, marginLeft: 8 }}>
              via <span>{doc.edge_path.join(" → ")}</span>
            </span>
          )}
        </li>
      ))}
    </ul>
  );
}
