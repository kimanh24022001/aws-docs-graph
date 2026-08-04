import type { Metadata } from "next";
import { Providers } from "./providers";
import type { ReactNode } from "react";
import Link from "next/link";

export const metadata: Metadata = {
  title: "AWS Docs Graph",
  description: "AWS documentation knowledge graph assistant",
};

function NavBar() {
  return (
    <>
      <style>{`
        .nav-link {
          display: flex;
          align-items: center;
          gap: 6px;
          padding: 8px 18px;
          border-radius: 24px;
          text-decoration: none;
          font-size: 13px;
          font-weight: 600;
          color: #999;
          transition: background 0.15s, color 0.15s;
        }
        .nav-link:hover {
          background: rgba(255,255,255,0.12);
          color: #fff;
        }
      `}</style>
      <nav
        style={{
          position: "fixed",
          bottom: 20,
          left: "50%",
          transform: "translateX(-50%)",
          zIndex: 1000,
          display: "flex",
          gap: 4,
          background: "rgba(15,15,20,0.85)",
          backdropFilter: "blur(12px)",
          border: "1px solid rgba(255,255,255,0.1)",
          borderRadius: 32,
          padding: "6px 8px",
          boxShadow: "0 4px 24px rgba(0,0,0,0.4)",
        }}
      >
        <Link href="/ask" className="nav-link">
          ✦ Ask
        </Link>
        <Link href="/galaxy" className="nav-link">
          🌌 Galaxy
        </Link>
        <Link href="/history" className="nav-link">
          ⏱ History
        </Link>
      </nav>
    </>
  );
}

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          fontFamily:
            "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
          background: "#fafafa",
          color: "#111",
        }}
      >
        <Providers>{children}</Providers>
        <NavBar />
      </body>
    </html>
  );
}
