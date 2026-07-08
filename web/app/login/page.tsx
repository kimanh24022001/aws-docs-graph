"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { createBrowserClient } from "@/lib/supabase";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    const supabase = createBrowserClient();
    const { error: authError } = await supabase.auth.signInWithPassword({
      email,
      password,
    });
    setLoading(false);
    if (authError) {
      setError(authError.message);
      return;
    }
    router.push("/ask");
  }

  return (
    <main
      style={{
        maxWidth: 400,
        margin: "80px auto",
        padding: 24,
        background: "#fff",
        borderRadius: 8,
        boxShadow: "0 2px 16px rgba(0,0,0,0.08)",
      }}
    >
      <h1 style={{ fontSize: 22, marginBottom: 4 }}>Sign in</h1>
      <p style={{ color: "#888", fontSize: 14, marginBottom: 20 }}>
        This is an invite-only tool. Contact your admin for access.
      </p>
      <form onSubmit={handleSubmit}>
        <label style={{ display: "block", marginBottom: 4, fontWeight: 600 }}>
          Email
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            style={{
              display: "block",
              width: "100%",
              marginTop: 4,
              padding: 8,
              fontSize: 15,
              border: "1px solid #ccc",
              borderRadius: 4,
              boxSizing: "border-box",
            }}
          />
        </label>
        <label
          style={{
            display: "block",
            marginBottom: 16,
            fontWeight: 600,
            marginTop: 12,
          }}
        >
          Password
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            style={{
              display: "block",
              width: "100%",
              marginTop: 4,
              padding: 8,
              fontSize: 15,
              border: "1px solid #ccc",
              borderRadius: 4,
              boxSizing: "border-box",
            }}
          />
        </label>
        {error && (
          <p style={{ color: "#c00", fontSize: 14, marginBottom: 12 }}>
            {error}
          </p>
        )}
        <button
          type="submit"
          disabled={loading}
          style={{
            width: "100%",
            padding: "10px 0",
            fontSize: 15,
            background: "#0070f3",
            color: "#fff",
            border: "none",
            borderRadius: 6,
            cursor: loading ? "not-allowed" : "pointer",
            opacity: loading ? 0.7 : 1,
          }}
        >
          {loading ? "Signing in…" : "Sign in"}
        </button>
      </form>
    </main>
  );
}
