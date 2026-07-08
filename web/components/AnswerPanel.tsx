interface Props {
  answer: string | null;
}

// Splits answer text on [n] markers and renders them as superscript anchor links.
function renderWithCitations(text: string) {
  const parts = text.split(/(\[\d+\])/g);
  return parts.map((part, i) => {
    const match = part.match(/^\[(\d+)\]$/);
    if (match) {
      const n = match[1];
      return (
        <sup key={i}>
          <a
            href={`#citation-${n}`}
            style={{ textDecoration: "none", color: "#0070f3" }}
          >
            [{n}]
          </a>
        </sup>
      );
    }
    return <span key={i}>{part}</span>;
  });
}

export function AnswerPanel({ answer }: Props) {
  if (answer === null) {
    return (
      <p style={{ color: "#666", fontStyle: "italic" }}>
        No written answer available.
      </p>
    );
  }
  return (
    <div style={{ lineHeight: 1.7, fontSize: 16 }}>
      <p>{renderWithCitations(answer)}</p>
    </div>
  );
}
