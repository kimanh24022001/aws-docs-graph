"use client";

import Link from "next/link";
import { useQueryHistory } from "@/lib/api";

export default function HistoryPage() {
  const { data, isLoading, isError } = useQueryHistory();

  if (isLoading)
    return (
      <main style={{ padding: 32 }}>
        <p>Loading…</p>
      </main>
    );
  if (isError)
    return (
      <main style={{ padding: 32 }}>
        <p style={{ color: "#c00" }}>Failed to load history.</p>
      </main>
    );

  return (
    <main style={{ maxWidth: 820, margin: "40px auto", padding: "0 16px" }}>
      <h1 style={{ fontSize: 24, marginBottom: 20 }}>Query History</h1>
      {data?.queries.length === 0 && (
        <p style={{ color: "#888" }}>
          No queries yet. <Link href="/ask">Ask your first question.</Link>
        </p>
      )}
      <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
        {data?.queries.map((q) => (
          <li
            key={q.id}
            style={{
              marginBottom: 12,
              padding: 14,
              background: "#fff",
              borderRadius: 6,
              border: "1px solid #e8e8e8",
            }}
          >
            <Link
              href={`/queries/${q.id}`}
              style={{
                color: "#0070f3",
                fontWeight: 600,
                textDecoration: "none",
              }}
            >
              {q.question}
            </Link>
            <span style={{ color: "#aaa", fontSize: 13, marginLeft: 12 }}>
              {new Date(q.created_at).toLocaleString()}
            </span>
          </li>
        ))}
      </ul>
    </main>
  );
}
