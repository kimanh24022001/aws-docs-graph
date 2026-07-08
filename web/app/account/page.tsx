"use client";

import { useMe } from "@/lib/api";

export default function AccountPage() {
  const { data, isLoading, isError } = useMe();

  if (isLoading)
    return (
      <main style={{ padding: 32 }}>
        <p>Loading…</p>
      </main>
    );
  if (isError)
    return (
      <main style={{ padding: 32 }}>
        <p style={{ color: "#c00" }}>Failed to load account.</p>
      </main>
    );

  return (
    <main style={{ maxWidth: 500, margin: "40px auto", padding: "0 16px" }}>
      <h1 style={{ fontSize: 24, marginBottom: 24 }}>Account</h1>
      <dl style={{ margin: 0 }}>
        <dt style={{ fontWeight: 600, color: "#555", fontSize: 13 }}>
          Display name
        </dt>
        <dd style={{ margin: "4px 0 16px", fontSize: 16 }}>
          {data?.display_name ?? <span style={{ color: "#aaa" }}>Not set</span>}
        </dd>
        <dt style={{ fontWeight: 600, color: "#555", fontSize: 13 }}>
          Daily cost today
        </dt>
        <dd style={{ margin: "4px 0", fontSize: 16 }}>
          ${data?.daily_cost_usd.toFixed(4)}{" "}
          <span style={{ color: "#aaa", fontSize: 13 }}>/ $0.50 cap</span>
        </dd>
      </dl>
    </main>
  );
}
