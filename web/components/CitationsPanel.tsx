import type { Citation } from "@/lib/types";

interface Props {
  citations: Citation[];
}

export function CitationsPanel({ citations }: Props) {
  if (citations.length === 0) {
    return <p style={{ color: "#666" }}>No citations available.</p>;
  }
  return (
    <ol style={{ paddingLeft: 20, margin: 0 }}>
      {citations.map((c) => (
        <li key={c.rank} id={`citation-${c.rank}`} style={{ marginBottom: 12 }}>
          <a
            href={c.url}
            target="_blank"
            rel="noreferrer"
            style={{ fontWeight: 600, color: "#0070f3" }}
          >
            {c.title}
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
            {c.service}
          </span>
          {c.snippet && (
            <p style={{ margin: "4px 0 0", color: "#555", fontSize: 14 }}>
              {c.snippet}
            </p>
          )}
        </li>
      ))}
    </ol>
  );
}
