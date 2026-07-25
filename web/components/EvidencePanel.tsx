"use client";

import { useState, useEffect } from "react";
import { fetchEvidence } from "@/lib/api";
import type { EvidenceItem, EvidenceResponse } from "@/lib/types";

interface Props {
  src: string;
  tgt: string;
  relType: string;
  color: string;
  onClose: () => void;
}

function ConfidenceBar({ value }: { value: number }) {
  const pct = Math.round(value * 100);
  const color =
    value >= 0.85 ? "#66bb6a" : value >= 0.7 ? "#ffd54f" : "#ef5350";
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <div style={{ flex: 1, height: 4, background: "#333", borderRadius: 2 }}>
        <div
          style={{
            width: `${pct}%`,
            height: "100%",
            background: color,
            borderRadius: 2,
          }}
        />
      </div>
      <span style={{ fontSize: 11, color: "#aaa", minWidth: 32 }}>{pct}%</span>
    </div>
  );
}

export function EvidencePanel({ src, tgt, relType, color, onClose }: Props) {
  const [data, setData] = useState<EvidenceResponse | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    fetchEvidence(src, tgt, relType)
      .then(setData)
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, [src, tgt, relType]);

  return (
    <div
      style={{
        position: "fixed",
        right: 0,
        top: 0,
        bottom: 0,
        width: 320,
        background: "#0d0d1a",
        borderLeft: `1px solid ${color}33`,
        display: "flex",
        flexDirection: "column",
        zIndex: 100,
        fontFamily: "sans-serif",
      }}
    >
      {/* Header */}
      <div
        style={{
          padding: "16px 16px 12px",
          borderBottom: `1px solid ${color}22`,
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <span
            style={{
              color: "#888",
              fontSize: 11,
              textTransform: "uppercase",
              letterSpacing: 1,
            }}
          >
            Relationship
          </span>
          <button
            onClick={onClose}
            style={{
              background: "none",
              border: "none",
              color: "#666",
              cursor: "pointer",
              fontSize: 16,
            }}
          >
            ×
          </button>
        </div>
        <div
          style={{
            marginTop: 8,
            display: "flex",
            alignItems: "center",
            gap: 8,
            flexWrap: "wrap",
          }}
        >
          <span style={{ color, fontWeight: 700, fontSize: 13 }}>
            {src.toUpperCase()}
          </span>
          <span style={{ color: "#555", fontSize: 11 }}>──</span>
          <span
            style={{
              background: `${color}22`,
              border: `1px solid ${color}55`,
              color,
              fontSize: 10,
              padding: "2px 6px",
              borderRadius: 3,
              fontWeight: 600,
            }}
          >
            {relType}
          </span>
          <span style={{ color: "#555", fontSize: 11 }}>──►</span>
          <span style={{ color, fontWeight: 700, fontSize: 13 }}>
            {tgt.toUpperCase()}
          </span>
        </div>
      </div>

      {/* Evidence */}
      <div style={{ flex: 1, overflowY: "auto", padding: 16 }}>
        {loading && (
          <p style={{ color: "#666", fontSize: 13 }}>Loading evidence…</p>
        )}
        {!loading && (!data || data.evidence.length === 0) && (
          <div>
            <p style={{ color: "#666", fontSize: 13, fontStyle: "italic" }}>
              "Detected from document pattern"
            </p>
            <div style={{ marginTop: 12 }}>
              <div style={{ color: "#555", fontSize: 11, marginBottom: 4 }}>
                Confidence
              </div>
              <ConfidenceBar value={0.6} />
            </div>
            <div style={{ marginTop: 8, color: "#555", fontSize: 11 }}>
              Method: Rule-based
            </div>
          </div>
        )}
        {!loading &&
          data &&
          data.evidence.map((item: EvidenceItem, i: number) => (
            <div
              key={i}
              style={{
                marginBottom: 20,
                paddingBottom: 16,
                borderBottom:
                  i < data.evidence.length - 1 ? "1px solid #1a1a2e" : "none",
              }}
            >
              <p
                style={{
                  color: "#ddd",
                  fontSize: 13,
                  lineHeight: 1.6,
                  fontStyle: "italic",
                  margin: "0 0 12px",
                  borderLeft: `3px solid ${color}88`,
                  paddingLeft: 10,
                }}
              >
                "{item.evidence_text}"
              </p>
              <div style={{ color: "#888", fontSize: 11, marginBottom: 6 }}>
                Source
              </div>
              <div style={{ color: "#aaa", fontSize: 12, marginBottom: 4 }}>
                {item.source_doc_title || "AWS Documentation"}
              </div>
              <a
                href={item.source_url}
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  color: "#4fc3f7",
                  fontSize: 11,
                  textDecoration: "none",
                  display: "block",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                  marginBottom: 10,
                }}
              >
                🔗 {item.source_url.replace("https://", "")}
              </a>
              <div style={{ color: "#888", fontSize: 11, marginBottom: 4 }}>
                Confidence
              </div>
              <ConfidenceBar value={item.confidence} />
              <div style={{ marginTop: 6, color: "#555", fontSize: 10 }}>
                Method:{" "}
                {item.extraction_method === "llm"
                  ? "LLM extraction"
                  : item.extraction_method === "structured_parser"
                    ? "Structured parser"
                    : "Rule-based"}
              </div>
            </div>
          ))}
      </div>
    </div>
  );
}
