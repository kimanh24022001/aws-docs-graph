"use client";

import { useState, type FormEvent } from "react";

interface Props {
  onSubmit: (question: string) => void;
  isLoading: boolean;
}

export function QueryForm({ onSubmit, isLoading }: Props) {
  const [value, setValue] = useState("");

  const trimmed = value.trim();
  const isValid = trimmed.length >= 1 && trimmed.length <= 2000;

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!isValid || isLoading) return;
    onSubmit(trimmed);
  }

  return (
    <form onSubmit={handleSubmit}>
      <textarea
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="Ask a question about AWS..."
        rows={3}
        style={{
          width: "100%",
          fontSize: 16,
          padding: 10,
          borderRadius: 6,
          border: "1px solid #ccc",
          resize: "vertical",
          boxSizing: "border-box",
        }}
      />
      <button
        type="submit"
        disabled={!isValid || isLoading}
        style={{
          marginTop: 8,
          padding: "8px 20px",
          fontSize: 15,
          background: "#0070f3",
          color: "#fff",
          border: "none",
          borderRadius: 6,
          cursor: isValid && !isLoading ? "pointer" : "not-allowed",
          opacity: isValid && !isLoading ? 1 : 0.6,
        }}
      >
        {isLoading ? "Asking…" : "Ask"}
      </button>
    </form>
  );
}
