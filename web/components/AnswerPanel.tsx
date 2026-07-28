"use client";

import ReactMarkdown from "react-markdown";

interface Props {
  answer: string | null;
}

function addCitationLinks(text: string): string {
  // Convert [n] markers to markdown superscript links
  return text.replace(/\[(\d+)\]/g, (_, n) => `[[${n}]](#citation-${n})`);
}

export function AnswerPanel({ answer }: Props) {
  if (!answer) {
    return (
      <p style={{ color: "#666", fontStyle: "italic" }}>
        No written answer available.
      </p>
    );
  }

  return (
    <div
      style={{
        lineHeight: 1.8,
        fontSize: 15,
        color: "#1a1a1a",
      }}
      className="answer-content"
    >
      <style>{`
        .answer-content h1, .answer-content h2, .answer-content h3 {
          margin: 16px 0 8px;
          font-weight: 700;
          color: #111;
        }
        .answer-content h2 { font-size: 18px; }
        .answer-content h3 { font-size: 16px; }
        .answer-content p { margin: 0 0 12px; }
        .answer-content ul, .answer-content ol {
          margin: 0 0 12px;
          padding-left: 24px;
        }
        .answer-content li { margin-bottom: 4px; }
        .answer-content strong { font-weight: 600; }
        .answer-content a { color: #0070f3; text-decoration: none; }
        .answer-content a:hover { text-decoration: underline; }
        .answer-content code {
          background: #f4f4f5;
          padding: 1px 5px;
          border-radius: 3px;
          font-size: 13px;
        }
      `}</style>
      <ReactMarkdown>{addCitationLinks(answer)}</ReactMarkdown>
    </div>
  );
}
