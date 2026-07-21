"use client";

import { SemanticGalaxy } from "@/components/SemanticGalaxy";
import { useRouter } from "next/navigation";

export default function GraphPage() {
  const router = useRouter();

  return (
    <main>
      <div style={{ padding: "16px 24px", borderBottom: "1px solid #eee" }}>
        <h1 style={{ fontSize: 22, margin: 0 }}>AWS Docs Galaxy</h1>
        <p style={{ color: "#888", fontSize: 14, margin: "4px 0 0" }}>
          Click a node to focus · click background to reset
        </p>
      </div>
      <SemanticGalaxy
        width={typeof window !== "undefined" ? window.innerWidth : 1200}
        height={typeof window !== "undefined" ? window.innerHeight - 80 : 700}
        onNodeNavigate={(id) => router.push(`/graph/${id}`)}
      />
    </main>
  );
}
