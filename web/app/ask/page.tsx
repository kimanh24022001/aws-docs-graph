"use client";

import { useState } from "react";
import { QueryForm } from "@/components/QueryForm";
import { AnswerPanel } from "@/components/AnswerPanel";
import { CitationsPanel } from "@/components/CitationsPanel";
import { RelatedDocsPanel } from "@/components/RelatedDocsPanel";
import {
  DegradedBanner,
  type DegradedVariant,
} from "@/components/DegradedBanner";
import { useSubmitQuery } from "@/lib/api";
import type { QueryResponse } from "@/lib/types";

function degradedVariant(
  metadata: QueryResponse["metadata"],
): DegradedVariant | undefined {
  if (metadata.mcp_unavailable) return "mcp_unavailable";
  if (metadata.neo4j_unavailable) return "neo4j_unavailable";
  if (metadata.synthesis_failed) return "synthesis_failed";
  return undefined;
}

export default function AskPage() {
  const mutation = useSubmitQuery();
  const [result, setResult] = useState<QueryResponse | null>(null);

  function handleSubmit(question: string) {
    setResult(null);
    mutation.mutate(
      { question },
      {
        onSuccess: (data) => setResult(data),
      },
    );
  }

  return (
    <main style={{ maxWidth: 820, margin: "40px auto", padding: "0 16px" }}>
      <h1 style={{ fontSize: 24, marginBottom: 20 }}>Ask about AWS</h1>

      <QueryForm onSubmit={handleSubmit} isLoading={mutation.isPending} />

      {mutation.isError && (
        <p style={{ color: "#c00", marginTop: 16 }}>
          Something went wrong. Please try again.
        </p>
      )}

      {result && (
        <div style={{ marginTop: 32 }}>
          <DegradedBanner variant={degradedVariant(result.metadata)} />

          <section style={{ marginBottom: 32 }}>
            <h2 style={{ fontSize: 18, marginBottom: 12 }}>Answer</h2>
            <AnswerPanel
              answer={result.answer}
              citationCount={result.citations.length}
            />
          </section>

          <section style={{ marginBottom: 32 }}>
            <h2 style={{ fontSize: 18, marginBottom: 12 }}>
              Citations ({result.citations.length})
            </h2>
            <CitationsPanel citations={result.citations} />
          </section>

          <section>
            <h2 style={{ fontSize: 18, marginBottom: 12 }}>
              Related Docs ({result.related_docs.length})
            </h2>
            <RelatedDocsPanel relatedDocs={result.related_docs} />
          </section>
        </div>
      )}
    </main>
  );
}
