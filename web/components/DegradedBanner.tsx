const MESSAGES = {
  mcp_unavailable:
    "AWS docs search unavailable — showing related docs from our graph.",
  neo4j_unavailable: "Related-doc suggestions temporarily unavailable.",
  synthesis_failed:
    "Couldn't generate written answer; here are the most relevant pages.",
} as const;

export type DegradedVariant = keyof typeof MESSAGES;

interface Props {
  variant: DegradedVariant | undefined;
}

export function DegradedBanner({ variant }: Props) {
  if (!variant) return null;
  return (
    <div
      role="alert"
      style={{
        background: "#fff3cd",
        border: "1px solid #ffc107",
        borderRadius: 4,
        padding: "8px 12px",
        marginBottom: 12,
        fontSize: 14,
      }}
    >
      {MESSAGES[variant]}
    </div>
  );
}
