import type { Metadata } from "next";
import { Providers } from "./providers";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "AWS Docs Graph",
  description: "AWS documentation knowledge graph assistant",
};

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
      </body>
    </html>
  );
}
