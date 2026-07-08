"use client";

import { use } from "react";
import { AnswerPanel } from "@/components/AnswerPanel";
import { CitationsPanel } from "@/components/CitationsPanel";
import { RelatedDocsPanel } from "@/components/RelatedDocsPanel";
import {
  DegradedBanner,
  type DegradedVariant,
} from "@/components/DegradedBanner";
import { useQueryDetail } from "@/lib/api";
import type { QueryResponse } from "@/lib/types";

function degradedVariant(
  metadata: QueryResponse["metadata"],
): DegradedVariant | undefined {
  if (metadata.mcp_unavailable) return "mcp_unavailable";
  if (metadata.neo4j_unavailable) return "neo4j_unavailable";
  if (metadata.synthesis_failed) return "synthesis_failed";
  return undefined;
}

export default function QueryDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const { data, isLoading, isError } = useQueryDetail(id);

  if (isLoading)
    return (
      <main style={{ padding: 32 }}>
        <p>Loading…</p>
      </main>
    );
  if (isError || !data)
    return (
      <main style={{ padding: 32 }}>
        <p style={{ color: "#c00" }}>Query not found.</p>
      </main>
    );

  return (
    <main style={{ maxWidth: 820, margin: "40px auto", padding: "0 16px" }}>
      <h1 style={{ fontSize: 22, marginBottom: 20 }}>{data.question}</h1>

      <DegradedBanner variant={degradedVariant(data.metadata)} />

      <section style={{ marginBottom: 32 }}>
        <h2 style={{ fontSize: 18, marginBottom: 12 }}>Answer</h2>
        <AnswerPanel
          answer={data.answer}
          citationCount={data.citations.length}
        />
      </section>

      <section style={{ marginBottom: 32 }}>
        <h2 style={{ fontSize: 18, marginBottom: 12 }}>
          Citations ({data.citations.length})
        </h2>
        <CitationsPanel citations={data.citations} />
      </section>

      <section>
        <h2 style={{ fontSize: 18, marginBottom: 12 }}>
          Related Docs ({data.related_docs.length})
        </h2>
        <RelatedDocsPanel relatedDocs={data.related_docs} />
      </section>
    </main>
  );
}
