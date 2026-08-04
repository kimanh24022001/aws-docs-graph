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

  const queries = data?.queries ?? [];
  const succeeded = queries.filter((q) => q.status === "succeeded");

  return (
    <main
      style={{ maxWidth: 820, margin: "40px auto", padding: "0 16px 80px" }}
    >
      <h1 style={{ fontSize: 24, marginBottom: 4 }}>Query History</h1>
      <p style={{ color: "#888", fontSize: 13, marginBottom: 20 }}>
        {succeeded.length} answered · {queries.length - succeeded.length}{" "}
        failed/pending
      </p>

      {succeeded.length === 0 && (
        <p style={{ color: "#888" }}>
          No queries yet. <Link href="/ask">Ask your first question.</Link>
        </p>
      )}

      <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
        {succeeded.map((q) => (
          <li
            key={q.id}
            style={{
              marginBottom: 10,
              padding: "12px 16px",
              background: "#fff",
              borderRadius: 8,
              border: "1px solid #e8e8e8",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 12,
            }}
          >
            <Link
              href={`/queries/${q.id}`}
              style={{
                color: "#0070f3",
                fontWeight: 600,
                textDecoration: "none",
                flex: 1,
              }}
            >
              {q.question}
            </Link>
            <span style={{ color: "#aaa", fontSize: 12, whiteSpace: "nowrap" }}>
              {new Date(q.created_at).toLocaleString()}
            </span>
          </li>
        ))}
      </ul>
    </main>
  );
}
