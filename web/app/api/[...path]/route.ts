import { NextRequest, NextResponse } from "next/server";

const API_BASE = process.env.API_URL ?? process.env.NEXT_PUBLIC_API_URL ?? "";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> },
) {
  const { path } = await params;
  const url = new URL(request.url);
  const target = `${API_BASE}/${path.join("/")}${url.search}`;

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  // Forward auth headers
  const userId = request.headers.get("x-user-id");
  const orgId = request.headers.get("x-org-id");
  const auth = request.headers.get("authorization");
  if (userId) headers["X-User-Id"] = userId;
  if (orgId) headers["X-Org-Id"] = orgId;
  if (auth) headers["Authorization"] = auth;

  const res = await fetch(target, { headers });
  const data = await res.json();
  return NextResponse.json(data, { status: res.status });
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> },
) {
  const { path } = await params;
  const target = `${API_BASE}/${path.join("/")}`;

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  const userId = request.headers.get("x-user-id");
  const orgId = request.headers.get("x-org-id");
  const auth = request.headers.get("authorization");
  const idempKey = request.headers.get("idempotency-key");
  if (userId) headers["X-User-Id"] = userId;
  if (orgId) headers["X-Org-Id"] = orgId;
  if (auth) headers["Authorization"] = auth;
  if (idempKey) headers["Idempotency-Key"] = idempKey;

  const body = await request.text();
  const res = await fetch(target, { method: "POST", headers, body });
  const data = await res.json();
  return NextResponse.json(data, { status: res.status });
}
