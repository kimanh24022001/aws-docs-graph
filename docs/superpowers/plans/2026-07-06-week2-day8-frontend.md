# Week 2 Day 8 — Next.js Frontend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Next.js 15 App Router frontend so a signed-in user can submit a question at `/ask` and see an answer with citations and related docs in the browser, deployed to Vercel.

**Architecture:** Next.js 15 App Router with server-side Supabase Auth (httpOnly cookies + middleware route guard). All data fetching goes through TanStack Query v5 hitting the Java api-service via `NEXT_PUBLIC_API_URL`. Supabase client is auth-only — never used for data reads. The graph page is a stubbed `react-force-graph-2d` canvas (full implementation is Day 9). The frontend is deployed to Vercel Hobby tier; environment variables are set in the Vercel dashboard.

**Tech Stack:** Next.js 15 (App Router), TypeScript 5, TanStack Query v5, `@supabase/ssr` (httpOnly cookie auth), `react-force-graph-2d`, Vitest, React Testing Library, MSW 2, happy-dom, Prettier, ESLint

---

## Global Constraints

- Next.js version: 15 (App Router only — no Pages Router)
- TypeScript strict mode enabled
- Supabase client (`lib/supabase.ts`) used **only** for auth — never for data reads/writes
- API base URL from `NEXT_PUBLIC_API_URL` env var — no hardcoded URLs
- Auth session: Supabase httpOnly cookies via `@supabase/ssr`
- All protected routes redirect unauthenticated users to `/login` via `middleware.ts`
- Degraded banner copy is verbatim from design doc §8.5 — do not paraphrase
- `react-force-graph-2d` on `/graph` is a stub (loads data, renders canvas, no click-through) — full drill-down is Day 9
- Tests use Vitest + RTL + MSW 2 (not Jest, not Cypress)
- Coverage target: ~50% on components + lib
- Vercel Hobby tier — no edge functions, no custom runtimes

---

## File Structure

```
web/
├── app/
│   ├── layout.tsx                  Root layout: HTML shell, Supabase session provider, TanStack Query provider
│   ├── page.tsx                    / — server component redirect: /ask if session, /login if not
│   ├── login/
│   │   └── page.tsx                Login page: Supabase email+password form, invite-only note
│   ├── ask/
│   │   └── page.tsx                Ask page: QueryForm + result area (AnswerPanel + CitationsPanel + RelatedDocsPanel + DegradedBanner)
│   ├── history/
│   │   └── page.tsx                Paginated query history list
│   ├── queries/
│   │   └── [id]/
│   │       └── page.tsx            Full query detail view
│   ├── graph/
│   │   └── page.tsx                Force-directed graph stub (GraphCanvas component)
│   └── account/
│       └── page.tsx                Display name + daily cost used
├── components/
│   ├── QueryForm.tsx               Controlled textarea + submit button; calls POST /v1/queries via mutation
│   ├── AnswerPanel.tsx             Renders answer text with inline [n] citation markers as superscript links
│   ├── CitationsPanel.tsx          Ordered list of citations: rank, title (link), service badge, snippet
│   ├── RelatedDocsPanel.tsx        List of related docs: title (link), service badge, hop_count, edge_path
│   ├── DegradedBanner.tsx          Accepts `variant` prop; renders one of 3 warning banners
│   ├── GraphCanvas.tsx             react-force-graph-2d wrapper; color-by-service; click logs node id
│   └── NodeDetailPanel.tsx         Stub — title, URL, service, word_count; full drill-down wired in Day 9
├── lib/
│   ├── api.ts                      Typed fetch helpers + TanStack Query hooks (useSubmitQuery, useQuery, useQueryHistory, useGraphOverview, useMe)
│   └── supabase.ts                 Browser Supabase client (auth only)
├── middleware.ts                   Protected route guard: unauthenticated → /login
├── next.config.ts                  Next.js config (transpilePackages for react-force-graph-2d)
├── tsconfig.json                   TypeScript strict config
├── vitest.config.ts                Vitest config with happy-dom + MSW setup
├── vitest.setup.ts                 MSW server start/stop + RTL cleanup
└── package.json                    All dependencies pinned
```

---

## API contract (what the frontend consumes)

These are the Java api-service response shapes consumed by the frontend. They are built from the design doc §Appendix A and §4.3.

**`POST /v1/queries`**
Request: `{ question: string }`, header `Authorization: Bearer <jwt>`, header `Idempotency-Key: <uuid>`
Response (200):
```typescript
interface QueryResponse {
  id: string;
  question: string;
  answer: string | null;
  citations: Citation[];
  related_docs: RelatedDoc[];
  metadata: {
    duration_ms: number;
    cost_usd: number;
    degraded: boolean;
    truncated: boolean;
    mcp_unavailable?: boolean;
    neo4j_unavailable?: boolean;
    synthesis_failed?: boolean;
  };
  created_at: string;
}
```

**`GET /v1/queries`** — `{ queries: QueryResponse[], next_cursor: string | null }`

**`GET /v1/queries/:id`** — `QueryResponse`

**`GET /v1/me`** — `{ id: string, display_name: string | null, daily_cost_usd: number }`

**`GET /v1/graph/overview`** — `{ nodes: GraphNode[], edges: GraphEdge[] }`

**Supporting types:**
```typescript
interface Citation {
  rank: number;
  title: string;
  url: string;
  service: string;
  snippet: string | null;
  score: number;
  source_kind: "mcp_search" | "graph_traversal";
}

interface RelatedDoc {
  title: string;
  url: string;
  service: string;
  hop_count: number;
  edge_path: string[];
}

interface GraphNode {
  id: string;
  url: string;
  title: string | null;
  service: string | null;
}

interface GraphEdge {
  source: string;
  target: string;
  type: "LINKS_TO" | "PREV_NEXT" | "CO_RETURNED";
}
```

---

### Task 1: Project scaffold

**Files:**
- Create: `web/package.json`
- Create: `web/tsconfig.json`
- Create: `web/next.config.ts`
- Create: `web/vitest.config.ts`
- Create: `web/vitest.setup.ts`
- Create: `web/.env.example`

**Interfaces:**
- Produces: runnable `next dev`, runnable `vitest`, all deps available

- [ ] **Step 1: Create `web/package.json`**

  ```json
  {
    "name": "aws-docs-graph-web",
    "version": "0.1.0",
    "private": true,
    "scripts": {
      "dev": "next dev",
      "build": "next build",
      "start": "next start",
      "lint": "next lint",
      "test": "vitest run",
      "test:watch": "vitest"
    },
    "dependencies": {
      "next": "15.3.3",
      "react": "^19.0.0",
      "react-dom": "^19.0.0",
      "@supabase/ssr": "^0.5.2",
      "@supabase/supabase-js": "^2.45.4",
      "@tanstack/react-query": "^5.62.7",
      "react-force-graph-2d": "^1.25.7",
      "uuid": "^10.0.0"
    },
    "devDependencies": {
      "@types/node": "^22.0.0",
      "@types/react": "^19.0.0",
      "@types/react-dom": "^19.0.0",
      "@types/uuid": "^10.0.0",
      "@testing-library/jest-dom": "^6.6.3",
      "@testing-library/react": "^16.1.0",
      "@testing-library/user-event": "^14.5.2",
      "@vitejs/plugin-react": "^4.3.4",
      "eslint": "^9.0.0",
      "eslint-config-next": "15.3.3",
      "happy-dom": "^15.11.7",
      "msw": "^2.7.0",
      "typescript": "^5.7.2",
      "vitest": "^2.1.8"
    }
  }
  ```

- [ ] **Step 2: Create `web/tsconfig.json`**

  ```json
  {
    "compilerOptions": {
      "target": "ES2017",
      "lib": ["dom", "dom.iterable", "esnext"],
      "allowJs": true,
      "skipLibCheck": true,
      "strict": true,
      "noEmit": true,
      "esModuleInterop": true,
      "module": "esnext",
      "moduleResolution": "bundler",
      "resolveJsonModule": true,
      "isolatedModules": true,
      "jsx": "preserve",
      "incremental": true,
      "plugins": [{ "name": "next" }],
      "paths": {
        "@/*": ["./*"]
      }
    },
    "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
    "exclude": ["node_modules"]
  }
  ```

- [ ] **Step 3: Create `web/next.config.ts`**

  `react-force-graph-2d` ships CommonJS; Next.js needs to transpile it.

  ```typescript
  import type { NextConfig } from "next";

  const nextConfig: NextConfig = {
    transpilePackages: ["react-force-graph-2d", "three-forcegraph", "three"],
  };

  export default nextConfig;
  ```

- [ ] **Step 4: Create `web/vitest.config.ts`**

  ```typescript
  import { defineConfig } from "vitest/config";
  import react from "@vitejs/plugin-react";
  import path from "path";

  export default defineConfig({
    plugins: [react()],
    test: {
      environment: "happy-dom",
      globals: true,
      setupFiles: ["./vitest.setup.ts"],
    },
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "."),
      },
    },
  });
  ```

- [ ] **Step 5: Create `web/vitest.setup.ts`**

  ```typescript
  import "@testing-library/jest-dom";
  import { afterAll, afterEach, beforeAll } from "vitest";
  import { server } from "./tests/mocks/server";

  beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
  afterEach(() => server.resetHandlers());
  afterAll(() => server.close());
  ```

- [ ] **Step 6: Create `web/.env.example`**

  ```
  NEXT_PUBLIC_API_URL=https://api.yourdomain.com
  NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
  NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
  ```

- [ ] **Step 7: Install dependencies**

  ```bash
  cd /path/to/aws-docs-graph/web
  npm install
  ```

  Expected: `node_modules/` populated, no peer-dep errors.

- [ ] **Step 8: Verify TypeScript compiles**

  ```bash
  cd /path/to/aws-docs-graph/web
  npx tsc --noEmit
  ```

  Expected: exits 0 (no errors — only boilerplate files exist yet).

- [ ] **Step 9: Commit**

  ```bash
  git add web/package.json web/package-lock.json web/tsconfig.json web/next.config.ts web/vitest.config.ts web/vitest.setup.ts web/.env.example
  git commit -m "feat(web): scaffold Next.js 15 project with Vitest + MSW"
  ```

---

### Task 2: MSW mock server + API types

**Files:**
- Create: `web/tests/mocks/server.ts`
- Create: `web/tests/mocks/handlers.ts`
- Create: `web/tests/mocks/fixtures.ts`
- Create: `web/lib/types.ts`

**Interfaces:**
- Produces: `server` (MSW SetupServer), `handlers` array, fixture objects used in all component tests

- [ ] **Step 1: Create `web/lib/types.ts`**

  ```typescript
  export interface Citation {
    rank: number;
    title: string;
    url: string;
    service: string;
    snippet: string | null;
    score: number;
    source_kind: "mcp_search" | "graph_traversal";
  }

  export interface RelatedDoc {
    title: string;
    url: string;
    service: string;
    hop_count: number;
    edge_path: string[];
  }

  export interface QueryMetadata {
    duration_ms: number;
    cost_usd: number;
    degraded: boolean;
    truncated: boolean;
    mcp_unavailable?: boolean;
    neo4j_unavailable?: boolean;
    synthesis_failed?: boolean;
  }

  export interface QueryResponse {
    id: string;
    question: string;
    answer: string | null;
    citations: Citation[];
    related_docs: RelatedDoc[];
    metadata: QueryMetadata;
    created_at: string;
  }

  export interface QueryHistoryResponse {
    queries: QueryResponse[];
    next_cursor: string | null;
  }

  export interface MeResponse {
    id: string;
    display_name: string | null;
    daily_cost_usd: number;
  }

  export interface GraphNode {
    id: string;
    url: string;
    title: string | null;
    service: string | null;
  }

  export interface GraphEdge {
    source: string;
    target: string;
    type: "LINKS_TO" | "PREV_NEXT" | "CO_RETURNED";
  }

  export interface GraphOverviewResponse {
    nodes: GraphNode[];
    edges: GraphEdge[];
  }
  ```

- [ ] **Step 2: Create `web/tests/mocks/fixtures.ts`**

  ```typescript
  import type { QueryResponse, QueryHistoryResponse, MeResponse, GraphOverviewResponse } from "@/lib/types";

  export const FIXTURE_QUERY_RESPONSE: QueryResponse = {
    id: "q_01HX000000000000000000",
    question: "How do I tag ECS resources for cost allocation?",
    answer:
      "To tag ECS resources for cost allocation, you add tags during resource creation [1]. Then activate the tags in the Billing console [2].",
    citations: [
      {
        rank: 1,
        title: "Tagging Amazon ECS resources",
        url: "https://docs.aws.amazon.com/AmazonECS/latest/developerguide/ecs-using-tags.html",
        service: "ECS",
        snippet: "You can tag most Amazon ECS resources when they are created or later.",
        score: 0.91,
        source_kind: "mcp_search",
      },
      {
        rank: 2,
        title: "Activating user-defined cost allocation tags",
        url: "https://docs.aws.amazon.com/awsaccountbilling/latest/aboutv2/activating-tags.html",
        service: "Billing",
        snippet: "You must activate cost allocation tags before they appear in Cost Explorer.",
        score: 0.87,
        source_kind: "mcp_search",
      },
    ],
    related_docs: [
      {
        title: "AWS Cost Explorer",
        url: "https://docs.aws.amazon.com/awsaccountbilling/latest/aboutv2/ce-what-is.html",
        service: "Billing",
        hop_count: 1,
        edge_path: ["LINKS_TO"],
      },
    ],
    metadata: {
      duration_ms: 8420,
      cost_usd: 0.006,
      degraded: false,
      truncated: false,
    },
    created_at: "2026-07-06T10:00:00Z",
  };

  export const FIXTURE_QUERY_MCP_DOWN: QueryResponse = {
    ...FIXTURE_QUERY_RESPONSE,
    id: "q_02HX000000000000000000",
    answer: null,
    citations: [],
    metadata: {
      ...FIXTURE_QUERY_RESPONSE.metadata,
      degraded: true,
      mcp_unavailable: true,
    },
  };

  export const FIXTURE_QUERY_NEO4J_DOWN: QueryResponse = {
    ...FIXTURE_QUERY_RESPONSE,
    id: "q_03HX000000000000000000",
    related_docs: [],
    metadata: {
      ...FIXTURE_QUERY_RESPONSE.metadata,
      degraded: true,
      neo4j_unavailable: true,
    },
  };

  export const FIXTURE_QUERY_SYNTHESIS_FAILED: QueryResponse = {
    ...FIXTURE_QUERY_RESPONSE,
    id: "q_04HX000000000000000000",
    answer: null,
    metadata: {
      ...FIXTURE_QUERY_RESPONSE.metadata,
      degraded: true,
      synthesis_failed: true,
    },
  };

  export const FIXTURE_QUERY_HISTORY: QueryHistoryResponse = {
    queries: [FIXTURE_QUERY_RESPONSE],
    next_cursor: null,
  };

  export const FIXTURE_ME: MeResponse = {
    id: "user_01HX000000000000000000",
    display_name: "Test User",
    daily_cost_usd: 0.12,
  };

  export const FIXTURE_GRAPH_OVERVIEW: GraphOverviewResponse = {
    nodes: [
      { id: "doc_01", url: "https://docs.aws.amazon.com/AmazonECS/latest/developerguide/ecs-using-tags.html", title: "Tagging Amazon ECS resources", service: "ECS" },
      { id: "doc_02", url: "https://docs.aws.amazon.com/awsaccountbilling/latest/aboutv2/ce-what-is.html", title: "AWS Cost Explorer", service: "Billing" },
    ],
    edges: [
      { source: "doc_01", target: "doc_02", type: "LINKS_TO" },
    ],
  };
  ```

- [ ] **Step 3: Create `web/tests/mocks/handlers.ts`**

  ```typescript
  import { http, HttpResponse } from "msw";
  import {
    FIXTURE_QUERY_RESPONSE,
    FIXTURE_QUERY_HISTORY,
    FIXTURE_ME,
    FIXTURE_GRAPH_OVERVIEW,
  } from "./fixtures";

  const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8080";

  export const handlers = [
    http.post(`${API_BASE}/v1/queries`, () =>
      HttpResponse.json(FIXTURE_QUERY_RESPONSE)
    ),

    http.get(`${API_BASE}/v1/queries`, () =>
      HttpResponse.json(FIXTURE_QUERY_HISTORY)
    ),

    http.get(`${API_BASE}/v1/queries/:id`, ({ params }) => {
      if (params.id === FIXTURE_QUERY_RESPONSE.id) {
        return HttpResponse.json(FIXTURE_QUERY_RESPONSE);
      }
      return HttpResponse.json({ error: "not found" }, { status: 404 });
    }),

    http.get(`${API_BASE}/v1/me`, () => HttpResponse.json(FIXTURE_ME)),

    http.get(`${API_BASE}/v1/graph/overview`, () =>
      HttpResponse.json(FIXTURE_GRAPH_OVERVIEW)
    ),
  ];
  ```

- [ ] **Step 4: Create `web/tests/mocks/server.ts`**

  ```typescript
  import { setupServer } from "msw/node";
  import { handlers } from "./handlers";

  export const server = setupServer(...handlers);
  ```

- [ ] **Step 5: Verify types compile**

  ```bash
  cd /path/to/aws-docs-graph/web
  npx tsc --noEmit
  ```

  Expected: exits 0.

- [ ] **Step 6: Commit**

  ```bash
  git add web/lib/types.ts web/tests/mocks/
  git commit -m "feat(web): add API types and MSW mock server with fixtures"
  ```

---

### Task 3: Supabase auth client + API client + TanStack Query hooks

**Files:**
- Create: `web/lib/supabase.ts`
- Create: `web/lib/api.ts`
- Create: `web/tests/lib/api.test.ts`

**Interfaces:**
- Produces:
  - `createBrowserClient()` from `lib/supabase.ts` — returns Supabase browser client (auth only)
  - `useSubmitQuery(options?)` — TanStack Query `useMutation`, calls `POST /v1/queries`, returns `QueryResponse`
  - `useQueryDetail(id: string)` — `useQuery`, calls `GET /v1/queries/:id`, returns `QueryResponse`
  - `useQueryHistory(cursor?: string)` — `useQuery`, calls `GET /v1/queries`, returns `QueryHistoryResponse`
  - `useMe()` — `useQuery`, calls `GET /v1/me`, returns `MeResponse`
  - `useGraphOverview()` — `useQuery`, calls `GET /v1/graph/overview`, returns `GraphOverviewResponse`
  - `QueryClientProvider` wrapper re-exported as `Providers` (wraps TanStack QueryClientProvider)

- [ ] **Step 1: Write failing tests for API hooks**

  Create `web/tests/lib/api.test.tsx`:

  ```typescript
  import { describe, it, expect } from "vitest";
  import { renderHook, waitFor, act } from "@testing-library/react";
  import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
  import { useMe, useQueryHistory, useSubmitQuery, useQueryDetail } from "@/lib/api";
  import { FIXTURE_ME, FIXTURE_QUERY_HISTORY, FIXTURE_QUERY_RESPONSE } from "../mocks/fixtures";
  import type { ReactNode } from "react";

  function wrapper({ children }: { children: ReactNode }) {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  }

  describe("useMe", () => {
    it("fetches /v1/me and returns user data", async () => {
      const { result } = renderHook(() => useMe(), { wrapper });
      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(result.current.data).toEqual(FIXTURE_ME);
    });
  });

  describe("useQueryHistory", () => {
    it("fetches /v1/queries and returns query list", async () => {
      const { result } = renderHook(() => useQueryHistory(), { wrapper });
      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(result.current.data?.queries).toHaveLength(1);
      expect(result.current.data?.queries[0].id).toBe(FIXTURE_QUERY_RESPONSE.id);
    });
  });

  describe("useQueryDetail", () => {
    it("fetches /v1/queries/:id and returns query", async () => {
      const { result } = renderHook(
        () => useQueryDetail(FIXTURE_QUERY_RESPONSE.id),
        { wrapper }
      );
      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(result.current.data?.question).toBe(FIXTURE_QUERY_RESPONSE.question);
    });
  });

  describe("useSubmitQuery", () => {
    it("posts to /v1/queries and returns QueryResponse", async () => {
      const { result } = renderHook(() => useSubmitQuery(), { wrapper });
      act(() => {
        result.current.mutate({ question: "How do I tag ECS resources?" });
      });
      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(result.current.data?.answer).toContain("tag");
    });
  });
  ```

- [ ] **Step 2: Run tests — expect FAIL**

  ```bash
  cd /path/to/aws-docs-graph/web
  npx vitest run tests/lib/api.test.tsx
  ```

  Expected: FAIL — `Cannot find module '@/lib/api'`

- [ ] **Step 3: Create `web/lib/supabase.ts`**

  ```typescript
  import { createBrowserClient as _createBrowserClient } from "@supabase/ssr";

  export function createBrowserClient() {
    return _createBrowserClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    );
  }
  ```

- [ ] **Step 4: Create `web/lib/api.ts`**

  ```typescript
  import { QueryClient, useMutation, useQuery } from "@tanstack/react-query";
  import { v4 as uuidv4 } from "uuid";
  import { createBrowserClient } from "./supabase";
  import type {
    QueryResponse,
    QueryHistoryResponse,
    MeResponse,
    GraphOverviewResponse,
  } from "./types";

  export const queryClient = new QueryClient({
    defaultOptions: {
      queries: { staleTime: 30_000, retry: 1 },
    },
  });

  const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "";

  async function getAuthHeader(): Promise<string> {
    const supabase = createBrowserClient();
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session?.access_token) throw new Error("Not authenticated");
    return `Bearer ${session.access_token}`;
  }

  async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
    const auth = await getAuthHeader();
    const res = await fetch(`${API_BASE}${path}`, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        Authorization: auth,
        ...init?.headers,
      },
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`API ${res.status}: ${text}`);
    }
    return res.json() as Promise<T>;
  }

  // ---- Mutations ----

  export function useSubmitQuery() {
    return useMutation({
      mutationFn: (payload: { question: string }) =>
        apiFetch<QueryResponse>("/v1/queries", {
          method: "POST",
          headers: { "Idempotency-Key": uuidv4() },
          body: JSON.stringify(payload),
        }),
    });
  }

  // ---- Queries ----

  export function useQueryDetail(id: string) {
    return useQuery({
      queryKey: ["queries", id],
      queryFn: () => apiFetch<QueryResponse>(`/v1/queries/${id}`),
      enabled: Boolean(id),
    });
  }

  export function useQueryHistory(cursor?: string) {
    return useQuery({
      queryKey: ["queries", "history", cursor],
      queryFn: () =>
        apiFetch<QueryHistoryResponse>(
          cursor ? `/v1/queries?cursor=${cursor}` : "/v1/queries"
        ),
    });
  }

  export function useMe() {
    return useQuery({
      queryKey: ["me"],
      queryFn: () => apiFetch<MeResponse>("/v1/me"),
    });
  }

  export function useGraphOverview() {
    return useQuery({
      queryKey: ["graph", "overview"],
      queryFn: () => apiFetch<GraphOverviewResponse>("/v1/graph/overview"),
      staleTime: 24 * 60 * 60 * 1000, // 24h — matches server cache
    });
  }
  ```

- [ ] **Step 5: Run tests — expect PASS**

  ```bash
  cd /path/to/aws-docs-graph/web
  npx vitest run tests/lib/api.test.tsx
  ```

  Expected: 4 tests pass.

- [ ] **Step 6: Commit**

  ```bash
  git add web/lib/supabase.ts web/lib/api.ts web/tests/lib/api.test.tsx
  git commit -m "feat(web): add Supabase auth client + TanStack Query API hooks"
  ```

---

### Task 4: `DegradedBanner` component

**Files:**
- Create: `web/components/DegradedBanner.tsx`
- Create: `web/tests/components/DegradedBanner.test.tsx`

**Interfaces:**
- Consumes: `variant: "mcp_unavailable" | "neo4j_unavailable" | "synthesis_failed"` prop
- Produces: renders one of 3 verbatim banner messages from design doc §8.5; renders nothing when no variant

- [ ] **Step 1: Write failing tests**

  Create `web/tests/components/DegradedBanner.test.tsx`:

  ```typescript
  import { describe, it, expect } from "vitest";
  import { render, screen } from "@testing-library/react";
  import { DegradedBanner } from "@/components/DegradedBanner";

  describe("DegradedBanner", () => {
    it("shows MCP unavailable message", () => {
      render(<DegradedBanner variant="mcp_unavailable" />);
      expect(
        screen.getByText(
          "AWS docs search unavailable — showing related docs from our graph."
        )
      ).toBeInTheDocument();
    });

    it("shows Neo4j unavailable message", () => {
      render(<DegradedBanner variant="neo4j_unavailable" />);
      expect(
        screen.getByText("Related-doc suggestions temporarily unavailable.")
      ).toBeInTheDocument();
    });

    it("shows synthesis failed message", () => {
      render(<DegradedBanner variant="synthesis_failed" />);
      expect(
        screen.getByText(
          "Couldn't generate written answer; here are the most relevant pages."
        )
      ).toBeInTheDocument();
    });

    it("renders nothing when variant is undefined", () => {
      const { container } = render(<DegradedBanner variant={undefined} />);
      expect(container).toBeEmptyDOMElement();
    });
  });
  ```

- [ ] **Step 2: Run tests — expect FAIL**

  ```bash
  cd /path/to/aws-docs-graph/web
  npx vitest run tests/components/DegradedBanner.test.tsx
  ```

  Expected: FAIL — `Cannot find module '@/components/DegradedBanner'`

- [ ] **Step 3: Implement `web/components/DegradedBanner.tsx`**

  ```typescript
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
  ```

- [ ] **Step 4: Run tests — expect PASS**

  ```bash
  cd /path/to/aws-docs-graph/web
  npx vitest run tests/components/DegradedBanner.test.tsx
  ```

  Expected: 4 tests pass.

- [ ] **Step 5: Commit**

  ```bash
  git add web/components/DegradedBanner.tsx web/tests/components/DegradedBanner.test.tsx
  git commit -m "feat(web): add DegradedBanner component with 3 variants"
  ```

---

### Task 5: `AnswerPanel` component

**Files:**
- Create: `web/components/AnswerPanel.tsx`
- Create: `web/tests/components/AnswerPanel.test.tsx`

**Interfaces:**
- Consumes: `answer: string | null`, `citationCount: number`
- Produces: renders answer text with `[n]` markers replaced by superscript links `[1]`…`[n]`; renders null state message when answer is null

- [ ] **Step 1: Write failing tests**

  Create `web/tests/components/AnswerPanel.test.tsx`:

  ```typescript
  import { describe, it, expect } from "vitest";
  import { render, screen } from "@testing-library/react";
  import { AnswerPanel } from "@/components/AnswerPanel";

  describe("AnswerPanel", () => {
    it("renders answer text", () => {
      render(
        <AnswerPanel
          answer="To tag ECS resources [1], activate in Billing [2]."
          citationCount={2}
        />
      );
      expect(screen.getByText(/To tag ECS resources/)).toBeInTheDocument();
    });

    it("renders inline citation markers as superscript links", () => {
      render(
        <AnswerPanel
          answer="See tagging docs [1] for details."
          citationCount={1}
        />
      );
      const link = screen.getByRole("link", { name: "[1]" });
      expect(link).toBeInTheDocument();
      expect(link).toHaveAttribute("href", "#citation-1");
    });

    it("renders null-state message when answer is null", () => {
      render(<AnswerPanel answer={null} citationCount={0} />);
      expect(
        screen.getByText("No written answer available.")
      ).toBeInTheDocument();
    });
  });
  ```

- [ ] **Step 2: Run tests — expect FAIL**

  ```bash
  cd /path/to/aws-docs-graph/web
  npx vitest run tests/components/AnswerPanel.test.tsx
  ```

  Expected: FAIL — module not found.

- [ ] **Step 3: Implement `web/components/AnswerPanel.tsx`**

  ```typescript
  interface Props {
    answer: string | null;
    citationCount: number;
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
            <a href={`#citation-${n}`} style={{ textDecoration: "none", color: "#0070f3" }}>
              [{n}]
            </a>
          </sup>
        );
      }
      return <span key={i}>{part}</span>;
    });
  }

  export function AnswerPanel({ answer, citationCount: _citationCount }: Props) {
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
  ```

- [ ] **Step 4: Run tests — expect PASS**

  ```bash
  cd /path/to/aws-docs-graph/web
  npx vitest run tests/components/AnswerPanel.test.tsx
  ```

  Expected: 3 tests pass.

- [ ] **Step 5: Commit**

  ```bash
  git add web/components/AnswerPanel.tsx web/tests/components/AnswerPanel.test.tsx
  git commit -m "feat(web): add AnswerPanel with inline citation markers"
  ```

---

### Task 6: `CitationsPanel` component

**Files:**
- Create: `web/components/CitationsPanel.tsx`
- Create: `web/tests/components/CitationsPanel.test.tsx`

**Interfaces:**
- Consumes: `citations: Citation[]` (from `lib/types.ts`)
- Produces: ordered list; each item has an `id="citation-{rank}"` anchor (for AnswerPanel links), title as external link, service badge, snippet text; renders empty state when citations is empty

- [ ] **Step 1: Write failing tests**

  Create `web/tests/components/CitationsPanel.test.tsx`:

  ```typescript
  import { describe, it, expect } from "vitest";
  import { render, screen } from "@testing-library/react";
  import { CitationsPanel } from "@/components/CitationsPanel";
  import { FIXTURE_QUERY_RESPONSE } from "../mocks/fixtures";

  describe("CitationsPanel", () => {
    it("renders all citations", () => {
      render(<CitationsPanel citations={FIXTURE_QUERY_RESPONSE.citations} />);
      expect(screen.getByText("Tagging Amazon ECS resources")).toBeInTheDocument();
      expect(screen.getByText("Activating user-defined cost allocation tags")).toBeInTheDocument();
    });

    it("renders title as external link", () => {
      render(<CitationsPanel citations={FIXTURE_QUERY_RESPONSE.citations} />);
      const link = screen.getByRole("link", { name: "Tagging Amazon ECS resources" });
      expect(link).toHaveAttribute(
        "href",
        "https://docs.aws.amazon.com/AmazonECS/latest/developerguide/ecs-using-tags.html"
      );
      expect(link).toHaveAttribute("target", "_blank");
    });

    it("renders service badge", () => {
      render(<CitationsPanel citations={FIXTURE_QUERY_RESPONSE.citations} />);
      expect(screen.getByText("ECS")).toBeInTheDocument();
    });

    it("renders anchor id for each citation", () => {
      render(<CitationsPanel citations={FIXTURE_QUERY_RESPONSE.citations} />);
      expect(document.getElementById("citation-1")).toBeInTheDocument();
    });

    it("renders snippet text", () => {
      render(<CitationsPanel citations={FIXTURE_QUERY_RESPONSE.citations} />);
      expect(
        screen.getByText(/You can tag most Amazon ECS resources/)
      ).toBeInTheDocument();
    });

    it("renders empty state when no citations", () => {
      render(<CitationsPanel citations={[]} />);
      expect(screen.getByText("No citations available.")).toBeInTheDocument();
    });
  });
  ```

- [ ] **Step 2: Run tests — expect FAIL**

  ```bash
  cd /path/to/aws-docs-graph/web
  npx vitest run tests/components/CitationsPanel.test.tsx
  ```

  Expected: FAIL — module not found.

- [ ] **Step 3: Implement `web/components/CitationsPanel.tsx`**

  ```typescript
  import type { Citation } from "@/lib/types";

  interface Props {
    citations: Citation[];
  }

  export function CitationsPanel({ citations }: Props) {
    if (citations.length === 0) {
      return <p style={{ color: "#666" }}>No citations available.</p>;
    }
    return (
      <ol style={{ paddingLeft: 20, margin: 0 }}>
        {citations.map((c) => (
          <li key={c.rank} id={`citation-${c.rank}`} style={{ marginBottom: 12 }}>
            <a
              href={c.url}
              target="_blank"
              rel="noreferrer"
              style={{ fontWeight: 600, color: "#0070f3" }}
            >
              {c.title}
            </a>{" "}
            <span
              style={{
                display: "inline-block",
                background: "#e8f0fe",
                color: "#1a73e8",
                borderRadius: 3,
                padding: "1px 6px",
                fontSize: 12,
                marginLeft: 4,
              }}
            >
              {c.service}
            </span>
            {c.snippet && (
              <p style={{ margin: "4px 0 0", color: "#555", fontSize: 14 }}>
                {c.snippet}
              </p>
            )}
          </li>
        ))}
      </ol>
    );
  }
  ```

- [ ] **Step 4: Run tests — expect PASS**

  ```bash
  cd /path/to/aws-docs-graph/web
  npx vitest run tests/components/CitationsPanel.test.tsx
  ```

  Expected: 6 tests pass.

- [ ] **Step 5: Commit**

  ```bash
  git add web/components/CitationsPanel.tsx web/tests/components/CitationsPanel.test.tsx
  git commit -m "feat(web): add CitationsPanel with ranked citations + service badges"
  ```

---

### Task 7: `RelatedDocsPanel` component

**Files:**
- Create: `web/components/RelatedDocsPanel.tsx`
- Create: `web/tests/components/RelatedDocsPanel.test.tsx`

**Interfaces:**
- Consumes: `relatedDocs: RelatedDoc[]` (from `lib/types.ts`)
- Produces: list of related docs with title (external link), service badge, hop count, edge path; empty state

- [ ] **Step 1: Write failing tests**

  Create `web/tests/components/RelatedDocsPanel.test.tsx`:

  ```typescript
  import { describe, it, expect } from "vitest";
  import { render, screen } from "@testing-library/react";
  import { RelatedDocsPanel } from "@/components/RelatedDocsPanel";
  import { FIXTURE_QUERY_RESPONSE } from "../mocks/fixtures";

  describe("RelatedDocsPanel", () => {
    it("renders related doc title as external link", () => {
      render(<RelatedDocsPanel relatedDocs={FIXTURE_QUERY_RESPONSE.related_docs} />);
      const link = screen.getByRole("link", { name: "AWS Cost Explorer" });
      expect(link).toHaveAttribute(
        "href",
        "https://docs.aws.amazon.com/awsaccountbilling/latest/aboutv2/ce-what-is.html"
      );
      expect(link).toHaveAttribute("target", "_blank");
    });

    it("renders hop count", () => {
      render(<RelatedDocsPanel relatedDocs={FIXTURE_QUERY_RESPONSE.related_docs} />);
      expect(screen.getByText(/1 hop/)).toBeInTheDocument();
    });

    it("renders edge path", () => {
      render(<RelatedDocsPanel relatedDocs={FIXTURE_QUERY_RESPONSE.related_docs} />);
      expect(screen.getByText("LINKS_TO")).toBeInTheDocument();
    });

    it("renders service badge", () => {
      render(<RelatedDocsPanel relatedDocs={FIXTURE_QUERY_RESPONSE.related_docs} />);
      expect(screen.getByText("Billing")).toBeInTheDocument();
    });

    it("renders empty state when no related docs", () => {
      render(<RelatedDocsPanel relatedDocs={[]} />);
      expect(screen.getByText("No related docs found.")).toBeInTheDocument();
    });
  });
  ```

- [ ] **Step 2: Run tests — expect FAIL**

  ```bash
  cd /path/to/aws-docs-graph/web
  npx vitest run tests/components/RelatedDocsPanel.test.tsx
  ```

  Expected: FAIL — module not found.

- [ ] **Step 3: Implement `web/components/RelatedDocsPanel.tsx`**

  ```typescript
  import type { RelatedDoc } from "@/lib/types";

  interface Props {
    relatedDocs: RelatedDoc[];
  }

  export function RelatedDocsPanel({ relatedDocs }: Props) {
    if (relatedDocs.length === 0) {
      return <p style={{ color: "#666" }}>No related docs found.</p>;
    }
    return (
      <ul style={{ paddingLeft: 20, margin: 0 }}>
        {relatedDocs.map((doc) => (
          <li key={doc.url} style={{ marginBottom: 10 }}>
            <a
              href={doc.url}
              target="_blank"
              rel="noreferrer"
              style={{ fontWeight: 600, color: "#0070f3" }}
            >
              {doc.title}
            </a>{" "}
            <span
              style={{
                display: "inline-block",
                background: "#e8f0fe",
                color: "#1a73e8",
                borderRadius: 3,
                padding: "1px 6px",
                fontSize: 12,
                marginLeft: 4,
              }}
            >
              {doc.service}
            </span>
            <span style={{ color: "#888", fontSize: 13, marginLeft: 8 }}>
              {doc.hop_count} hop{doc.hop_count !== 1 ? "s" : ""}
            </span>
            {doc.edge_path.length > 0 && (
              <span style={{ color: "#aaa", fontSize: 12, marginLeft: 8 }}>
                via {doc.edge_path.join(" → ")}
              </span>
            )}
          </li>
        ))}
      </ul>
    );
  }
  ```

- [ ] **Step 4: Run tests — expect PASS**

  ```bash
  cd /path/to/aws-docs-graph/web
  npx vitest run tests/components/RelatedDocsPanel.test.tsx
  ```

  Expected: 5 tests pass.

- [ ] **Step 5: Commit**

  ```bash
  git add web/components/RelatedDocsPanel.tsx web/tests/components/RelatedDocsPanel.test.tsx
  git commit -m "feat(web): add RelatedDocsPanel with hop count and edge path"
  ```

---

### Task 8: `QueryForm` component

**Files:**
- Create: `web/components/QueryForm.tsx`
- Create: `web/tests/components/QueryForm.test.tsx`

**Interfaces:**
- Consumes: `onSubmit: (question: string) => void`, `isLoading: boolean`
- Produces: textarea (min 1 char, max 2000 chars), submit button disabled when loading or blank, calls `onSubmit` with trimmed value on submit, shows "Asking…" in button when loading

- [ ] **Step 1: Write failing tests**

  Create `web/tests/components/QueryForm.test.tsx`:

  ```typescript
  import { describe, it, expect, vi } from "vitest";
  import { render, screen } from "@testing-library/react";
  import userEvent from "@testing-library/user-event";
  import { QueryForm } from "@/components/QueryForm";

  describe("QueryForm", () => {
    it("renders textarea and submit button", () => {
      render(<QueryForm onSubmit={vi.fn()} isLoading={false} />);
      expect(screen.getByRole("textbox")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /ask/i })).toBeInTheDocument();
    });

    it("calls onSubmit with trimmed question", async () => {
      const onSubmit = vi.fn();
      render(<QueryForm onSubmit={onSubmit} isLoading={false} />);
      await userEvent.type(screen.getByRole("textbox"), "  How do I tag ECS?  ");
      await userEvent.click(screen.getByRole("button", { name: /ask/i }));
      expect(onSubmit).toHaveBeenCalledWith("How do I tag ECS?");
    });

    it("disables button when input is blank", async () => {
      render(<QueryForm onSubmit={vi.fn()} isLoading={false} />);
      expect(screen.getByRole("button", { name: /ask/i })).toBeDisabled();
    });

    it("disables button and shows loading text when isLoading", async () => {
      render(<QueryForm onSubmit={vi.fn()} isLoading={true} />);
      const btn = screen.getByRole("button", { name: /asking/i });
      expect(btn).toBeDisabled();
    });

    it("does not submit when question exceeds 2000 chars", async () => {
      const onSubmit = vi.fn();
      render(<QueryForm onSubmit={onSubmit} isLoading={false} />);
      const textarea = screen.getByRole("textbox");
      await userEvent.type(textarea, "a".repeat(2001));
      await userEvent.click(screen.getByRole("button", { name: /ask/i }));
      expect(onSubmit).not.toHaveBeenCalled();
    });
  });
  ```

- [ ] **Step 2: Run tests — expect FAIL**

  ```bash
  cd /path/to/aws-docs-graph/web
  npx vitest run tests/components/QueryForm.test.tsx
  ```

  Expected: FAIL — module not found.

- [ ] **Step 3: Implement `web/components/QueryForm.tsx`**

  ```typescript
  "use client";

  import { useState, type FormEvent } from "react";

  interface Props {
    onSubmit: (question: string) => void;
    isLoading: boolean;
  }

  export function QueryForm({ onSubmit, isLoading }: Props) {
    const [value, setValue] = useState("");

    const trimmed = value.trim();
    const isValid = trimmed.length >= 1 && trimmed.length <= 2000;

    function handleSubmit(e: FormEvent) {
      e.preventDefault();
      if (!isValid || isLoading) return;
      onSubmit(trimmed);
    }

    return (
      <form onSubmit={handleSubmit}>
        <textarea
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="Ask a question about AWS..."
          rows={3}
          style={{
            width: "100%",
            fontSize: 16,
            padding: 10,
            borderRadius: 6,
            border: "1px solid #ccc",
            resize: "vertical",
            boxSizing: "border-box",
          }}
        />
        <button
          type="submit"
          disabled={!isValid || isLoading}
          style={{
            marginTop: 8,
            padding: "8px 20px",
            fontSize: 15,
            background: "#0070f3",
            color: "#fff",
            border: "none",
            borderRadius: 6,
            cursor: isValid && !isLoading ? "pointer" : "not-allowed",
            opacity: isValid && !isLoading ? 1 : 0.6,
          }}
        >
          {isLoading ? "Asking…" : "Ask"}
        </button>
      </form>
    );
  }
  ```

- [ ] **Step 4: Run tests — expect PASS**

  ```bash
  cd /path/to/aws-docs-graph/web
  npx vitest run tests/components/QueryForm.test.tsx
  ```

  Expected: 5 tests pass.

- [ ] **Step 5: Commit**

  ```bash
  git add web/components/QueryForm.tsx web/tests/components/QueryForm.test.tsx
  git commit -m "feat(web): add QueryForm with validation and loading state"
  ```

---

### Task 9: `GraphCanvas` component (stub)

**Files:**
- Create: `web/components/GraphCanvas.tsx`
- Create: `web/tests/components/GraphCanvas.test.tsx`

**Interfaces:**
- Consumes: `nodes: GraphNode[]`, `edges: GraphEdge[]`
- Produces: renders a `<canvas>` element (from `react-force-graph-2d`); assigns distinct colors to service strings; clicking a node logs its id (full navigation is Day 9)
- Note: `react-force-graph-2d` uses browser Canvas APIs not present in happy-dom — the component is tested by mocking the library

- [ ] **Step 1: Create MSW-independent mock for `react-force-graph-2d`**

  Create `web/tests/mocks/react-force-graph-2d.tsx`:

  ```typescript
  import { forwardRef } from "react";
  import type { GraphNode, GraphEdge } from "@/lib/types";

  interface MockProps {
    graphData?: { nodes: GraphNode[]; links: GraphEdge[] };
    nodeColor?: (node: GraphNode) => string;
    onNodeClick?: (node: GraphNode) => void;
    width?: number;
    height?: number;
  }

  const ForceGraph2D = forwardRef<HTMLCanvasElement, MockProps>(
    ({ graphData, onNodeClick }, ref) => (
      <canvas
        ref={ref}
        data-testid="force-graph"
        data-node-count={graphData?.nodes.length ?? 0}
        onClick={() => {
          if (onNodeClick && graphData?.nodes[0]) {
            onNodeClick(graphData.nodes[0]);
          }
        }}
      />
    )
  );

  ForceGraph2D.displayName = "ForceGraph2D";
  export default ForceGraph2D;
  ```

  Add the mock alias to `web/vitest.config.ts` — replace the existing file:

  ```typescript
  import { defineConfig } from "vitest/config";
  import react from "@vitejs/plugin-react";
  import path from "path";

  export default defineConfig({
    plugins: [react()],
    test: {
      environment: "happy-dom",
      globals: true,
      setupFiles: ["./vitest.setup.ts"],
      alias: {
        "react-force-graph-2d": path.resolve(
          __dirname,
          "tests/mocks/react-force-graph-2d.tsx"
        ),
      },
    },
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "."),
      },
    },
  });
  ```

- [ ] **Step 2: Write failing tests**

  Create `web/tests/components/GraphCanvas.test.tsx`:

  ```typescript
  import { describe, it, expect, vi } from "vitest";
  import { render, screen, fireEvent } from "@testing-library/react";
  import { GraphCanvas } from "@/components/GraphCanvas";
  import { FIXTURE_GRAPH_OVERVIEW } from "../mocks/fixtures";

  describe("GraphCanvas", () => {
    it("renders a canvas element", () => {
      render(
        <GraphCanvas
          nodes={FIXTURE_GRAPH_OVERVIEW.nodes}
          edges={FIXTURE_GRAPH_OVERVIEW.edges}
        />
      );
      expect(screen.getByTestId("force-graph")).toBeInTheDocument();
    });

    it("passes correct node count to the graph", () => {
      render(
        <GraphCanvas
          nodes={FIXTURE_GRAPH_OVERVIEW.nodes}
          edges={FIXTURE_GRAPH_OVERVIEW.edges}
        />
      );
      expect(screen.getByTestId("force-graph")).toHaveAttribute(
        "data-node-count",
        String(FIXTURE_GRAPH_OVERVIEW.nodes.length)
      );
    });

    it("calls onNodeClick with node when canvas clicked", () => {
      const onNodeClick = vi.fn();
      render(
        <GraphCanvas
          nodes={FIXTURE_GRAPH_OVERVIEW.nodes}
          edges={FIXTURE_GRAPH_OVERVIEW.edges}
          onNodeClick={onNodeClick}
        />
      );
      fireEvent.click(screen.getByTestId("force-graph"));
      expect(onNodeClick).toHaveBeenCalledWith(FIXTURE_GRAPH_OVERVIEW.nodes[0]);
    });
  });
  ```

- [ ] **Step 3: Run tests — expect FAIL**

  ```bash
  cd /path/to/aws-docs-graph/web
  npx vitest run tests/components/GraphCanvas.test.tsx
  ```

  Expected: FAIL — module not found.

- [ ] **Step 4: Implement `web/components/GraphCanvas.tsx`**

  ```typescript
  "use client";

  import ForceGraph2D from "react-force-graph-2d";
  import type { GraphNode, GraphEdge } from "@/lib/types";

  // Deterministic color per service string — uses a simple hash to pick from palette.
  const SERVICE_PALETTE = [
    "#4285f4", "#ea4335", "#fbbc05", "#34a853",
    "#ff6d00", "#46bdc6", "#9c27b0", "#e91e63",
    "#00bcd4", "#8bc34a", "#ff5722", "#607d8b",
  ];

  function serviceColor(service: string | null): string {
    if (!service) return "#999";
    let hash = 0;
    for (let i = 0; i < service.length; i++) {
      hash = (hash * 31 + service.charCodeAt(i)) & 0xffffff;
    }
    return SERVICE_PALETTE[Math.abs(hash) % SERVICE_PALETTE.length];
  }

  interface Props {
    nodes: GraphNode[];
    edges: GraphEdge[];
    onNodeClick?: (node: GraphNode) => void;
    width?: number;
    height?: number;
  }

  export function GraphCanvas({
    nodes,
    edges,
    onNodeClick,
    width = 900,
    height = 600,
  }: Props) {
    const graphData = {
      nodes,
      links: edges.map((e) => ({ ...e, source: e.source, target: e.target })),
    };

    return (
      <ForceGraph2D
        graphData={graphData}
        nodeColor={(node) => serviceColor((node as GraphNode).service)}
        nodeLabel={(node) => (node as GraphNode).title ?? (node as GraphNode).url}
        onNodeClick={(node) => {
          if (onNodeClick) onNodeClick(node as GraphNode);
        }}
        width={width}
        height={height}
      />
    );
  }
  ```

- [ ] **Step 5: Run tests — expect PASS**

  ```bash
  cd /path/to/aws-docs-graph/web
  npx vitest run tests/components/GraphCanvas.test.tsx
  ```

  Expected: 3 tests pass.

- [ ] **Step 6: Commit**

  ```bash
  git add web/components/GraphCanvas.tsx web/tests/components/GraphCanvas.test.tsx web/tests/mocks/react-force-graph-2d.tsx web/vitest.config.ts
  git commit -m "feat(web): add GraphCanvas stub with color-by-service"
  ```

---

### Task 10: Supabase middleware + root layout + providers

**Files:**
- Create: `web/middleware.ts`
- Create: `web/app/layout.tsx`
- Create: `web/app/providers.tsx`

**Interfaces:**
- Produces:
  - `middleware.ts`: redirects unauthenticated requests to `/login` for all routes except `/login` and `/_next/*` and `/favicon.ico`
  - `app/providers.tsx`: client component wrapping `QueryClientProvider` with `queryClient` from `lib/api.ts`
  - `app/layout.tsx`: server component with `<html><body>`, imports `Providers`, sets page metadata

- [ ] **Step 1: Create `web/app/providers.tsx`**

  ```typescript
  "use client";

  import { QueryClientProvider } from "@tanstack/react-query";
  import { queryClient } from "@/lib/api";
  import type { ReactNode } from "react";

  export function Providers({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
  }
  ```

- [ ] **Step 2: Create `web/app/layout.tsx`**

  ```typescript
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
  ```

- [ ] **Step 3: Create `web/middleware.ts`**

  The middleware reads the Supabase session from cookies. Unauthenticated requests to protected routes are redirected to `/login`.

  ```typescript
  import { createServerClient } from "@supabase/ssr";
  import { NextResponse, type NextRequest } from "next/server";

  export async function middleware(request: NextRequest) {
    let supabaseResponse = NextResponse.next({ request });

    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll() {
            return request.cookies.getAll();
          },
          setAll(cookiesToSet) {
            cookiesToSet.forEach(({ name, value }) =>
              request.cookies.set(name, value)
            );
            supabaseResponse = NextResponse.next({ request });
            cookiesToSet.forEach(({ name, value, options }) =>
              supabaseResponse.cookies.set(name, value, options)
            );
          },
        },
      }
    );

    const {
      data: { user },
    } = await supabase.auth.getUser();

    const { pathname } = request.nextUrl;

    const isPublic =
      pathname === "/login" ||
      pathname.startsWith("/_next") ||
      pathname === "/favicon.ico";

    if (!user && !isPublic) {
      const loginUrl = request.nextUrl.clone();
      loginUrl.pathname = "/login";
      return NextResponse.redirect(loginUrl);
    }

    return supabaseResponse;
  }

  export const config = {
    matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
  };
  ```

- [ ] **Step 4: Verify TypeScript compiles**

  ```bash
  cd /path/to/aws-docs-graph/web
  npx tsc --noEmit
  ```

  Expected: exits 0.

- [ ] **Step 5: Commit**

  ```bash
  git add web/middleware.ts web/app/layout.tsx web/app/providers.tsx
  git commit -m "feat(web): add Supabase middleware guard + root layout + TanStack Query providers"
  ```

---

### Task 11: Login page

**Files:**
- Create: `web/app/login/page.tsx`
- Create: `web/tests/pages/login.test.tsx`

**Interfaces:**
- Produces: email+password form; on success calls `supabase.auth.signInWithPassword` and `router.push('/ask')`; shows error message on auth failure; has invite-only note

- [ ] **Step 1: Write failing tests**

  Create `web/tests/pages/login.test.tsx`:

  ```typescript
  import { describe, it, expect, vi, beforeEach } from "vitest";
  import { render, screen, waitFor } from "@testing-library/react";
  import userEvent from "@testing-library/user-event";
  import LoginPage from "@/app/login/page";

  // Mock Supabase client
  const mockSignIn = vi.fn();
  vi.mock("@/lib/supabase", () => ({
    createBrowserClient: () => ({
      auth: {
        signInWithPassword: mockSignIn,
      },
    }),
  }));

  // Mock Next.js router
  const mockPush = vi.fn();
  vi.mock("next/navigation", () => ({
    useRouter: () => ({ push: mockPush }),
  }));

  describe("LoginPage", () => {
    beforeEach(() => {
      vi.clearAllMocks();
    });

    it("renders email and password fields", () => {
      render(<LoginPage />);
      expect(screen.getByLabelText(/email/i)).toBeInTheDocument();
      expect(screen.getByLabelText(/password/i)).toBeInTheDocument();
    });

    it("shows invite-only note", () => {
      render(<LoginPage />);
      expect(screen.getByText(/invite-only/i)).toBeInTheDocument();
    });

    it("calls signInWithPassword and redirects on success", async () => {
      mockSignIn.mockResolvedValue({ data: { session: {} }, error: null });
      render(<LoginPage />);
      await userEvent.type(screen.getByLabelText(/email/i), "user@example.com");
      await userEvent.type(screen.getByLabelText(/password/i), "secret123");
      await userEvent.click(screen.getByRole("button", { name: /sign in/i }));
      await waitFor(() => expect(mockSignIn).toHaveBeenCalledWith({
        email: "user@example.com",
        password: "secret123",
      }));
      expect(mockPush).toHaveBeenCalledWith("/ask");
    });

    it("shows error message on auth failure", async () => {
      mockSignIn.mockResolvedValue({
        data: null,
        error: { message: "Invalid login credentials" },
      });
      render(<LoginPage />);
      await userEvent.type(screen.getByLabelText(/email/i), "bad@example.com");
      await userEvent.type(screen.getByLabelText(/password/i), "wrong");
      await userEvent.click(screen.getByRole("button", { name: /sign in/i }));
      await waitFor(() =>
        expect(screen.getByText("Invalid login credentials")).toBeInTheDocument()
      );
    });
  });
  ```

- [ ] **Step 2: Run tests — expect FAIL**

  ```bash
  cd /path/to/aws-docs-graph/web
  npx vitest run tests/pages/login.test.tsx
  ```

  Expected: FAIL — module not found.

- [ ] **Step 3: Implement `web/app/login/page.tsx`**

  ```typescript
  "use client";

  import { useState, type FormEvent } from "react";
  import { useRouter } from "next/navigation";
  import { createBrowserClient } from "@/lib/supabase";

  export default function LoginPage() {
    const router = useRouter();
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [error, setError] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);

    async function handleSubmit(e: FormEvent) {
      e.preventDefault();
      setError(null);
      setLoading(true);
      const supabase = createBrowserClient();
      const { error: authError } = await supabase.auth.signInWithPassword({
        email,
        password,
      });
      setLoading(false);
      if (authError) {
        setError(authError.message);
        return;
      }
      router.push("/ask");
    }

    return (
      <main
        style={{
          maxWidth: 400,
          margin: "80px auto",
          padding: 24,
          background: "#fff",
          borderRadius: 8,
          boxShadow: "0 2px 16px rgba(0,0,0,0.08)",
        }}
      >
        <h1 style={{ fontSize: 22, marginBottom: 4 }}>Sign in</h1>
        <p style={{ color: "#888", fontSize: 14, marginBottom: 20 }}>
          This is an invite-only tool. Contact your admin for access.
        </p>
        <form onSubmit={handleSubmit}>
          <label style={{ display: "block", marginBottom: 4, fontWeight: 600 }}>
            Email
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              style={{
                display: "block",
                width: "100%",
                marginTop: 4,
                padding: 8,
                fontSize: 15,
                border: "1px solid #ccc",
                borderRadius: 4,
                boxSizing: "border-box",
              }}
            />
          </label>
          <label
            style={{
              display: "block",
              marginBottom: 16,
              fontWeight: 600,
              marginTop: 12,
            }}
          >
            Password
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              style={{
                display: "block",
                width: "100%",
                marginTop: 4,
                padding: 8,
                fontSize: 15,
                border: "1px solid #ccc",
                borderRadius: 4,
                boxSizing: "border-box",
              }}
            />
          </label>
          {error && (
            <p style={{ color: "#c00", fontSize: 14, marginBottom: 12 }}>
              {error}
            </p>
          )}
          <button
            type="submit"
            disabled={loading}
            style={{
              width: "100%",
              padding: "10px 0",
              fontSize: 15,
              background: "#0070f3",
              color: "#fff",
              border: "none",
              borderRadius: 6,
              cursor: loading ? "not-allowed" : "pointer",
              opacity: loading ? 0.7 : 1,
            }}
          >
            {loading ? "Signing in…" : "Sign in"}
          </button>
        </form>
      </main>
    );
  }
  ```

- [ ] **Step 4: Run tests — expect PASS**

  ```bash
  cd /path/to/aws-docs-graph/web
  npx vitest run tests/pages/login.test.tsx
  ```

  Expected: 4 tests pass.

- [ ] **Step 5: Commit**

  ```bash
  git add web/app/login/page.tsx web/tests/pages/login.test.tsx
  git commit -m "feat(web): add login page with Supabase email+password auth"
  ```

---

### Task 12: Root redirect page

**Files:**
- Create: `web/app/page.tsx`

**Interfaces:**
- Produces: server component; reads Supabase session server-side; redirects to `/ask` if session exists, `/login` if not

- [ ] **Step 1: Create `web/app/page.tsx`**

  ```typescript
  import { redirect } from "next/navigation";
  import { createServerClient } from "@supabase/ssr";
  import { cookies } from "next/headers";

  export default async function RootPage() {
    const cookieStore = await cookies();
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll() {
            return cookieStore.getAll();
          },
          setAll() {
            // Read-only in server component; middleware handles cookie writes.
          },
        },
      }
    );

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (user) {
      redirect("/ask");
    } else {
      redirect("/login");
    }
  }
  ```

- [ ] **Step 2: Verify TypeScript compiles**

  ```bash
  cd /path/to/aws-docs-graph/web
  npx tsc --noEmit
  ```

  Expected: exits 0.

- [ ] **Step 3: Commit**

  ```bash
  git add web/app/page.tsx
  git commit -m "feat(web): add root redirect — /ask if authed, /login otherwise"
  ```

---

### Task 13: `/ask` page — integration test + implementation

**Files:**
- Create: `web/app/ask/page.tsx`
- Create: `web/tests/pages/ask.test.tsx`

**Interfaces:**
- Consumes: `useSubmitQuery` mutation, `AnswerPanel`, `CitationsPanel`, `RelatedDocsPanel`, `DegradedBanner`, `QueryForm`
- Produces: full ask page; renders QueryForm; on submit calls mutation; shows loading state; shows all result panels on success; shows correct DegradedBanner variant when metadata flags are set

- [ ] **Step 1: Write failing integration tests**

  Create `web/tests/pages/ask.test.tsx`:

  ```typescript
  import { describe, it, expect, vi } from "vitest";
  import { render, screen, waitFor } from "@testing-library/react";
  import userEvent from "@testing-library/user-event";
  import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
  import { http, HttpResponse } from "msw";
  import { server } from "../mocks/server";
  import AskPage from "@/app/ask/page";
  import {
    FIXTURE_QUERY_RESPONSE,
    FIXTURE_QUERY_MCP_DOWN,
    FIXTURE_QUERY_NEO4J_DOWN,
    FIXTURE_QUERY_SYNTHESIS_FAILED,
  } from "../mocks/fixtures";
  import type { ReactNode } from "react";

  // Mock Supabase — tests don't need real auth
  vi.mock("@/lib/supabase", () => ({
    createBrowserClient: () => ({
      auth: { getSession: async () => ({ data: { session: { access_token: "test-token" } } }) },
    }),
  }));

  const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8080";

  function wrapper({ children }: { children: ReactNode }) {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  }

  describe("AskPage — happy path", () => {
    it("renders the question form", () => {
      render(<AskPage />, { wrapper });
      expect(screen.getByRole("textbox")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /ask/i })).toBeInTheDocument();
    });

    it("shows answer and citations after submitting a question", async () => {
      render(<AskPage />, { wrapper });
      await userEvent.type(screen.getByRole("textbox"), "How do I tag ECS resources?");
      await userEvent.click(screen.getByRole("button", { name: /ask/i }));
      await waitFor(() =>
        expect(screen.getByText(/To tag ECS resources/)).toBeInTheDocument()
      );
      expect(screen.getByText("Tagging Amazon ECS resources")).toBeInTheDocument();
      expect(screen.getByText("AWS Cost Explorer")).toBeInTheDocument();
    });

    it("shows no degraded banner on success", async () => {
      render(<AskPage />, { wrapper });
      await userEvent.type(screen.getByRole("textbox"), "How do I tag ECS resources?");
      await userEvent.click(screen.getByRole("button", { name: /ask/i }));
      await waitFor(() =>
        expect(screen.getByText(/To tag ECS resources/)).toBeInTheDocument()
      );
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    });
  });

  describe("AskPage — degraded banners", () => {
    it("shows MCP unavailable banner when mcp_unavailable=true", async () => {
      server.use(
        http.post(`${API_BASE}/v1/queries`, () =>
          HttpResponse.json(FIXTURE_QUERY_MCP_DOWN)
        )
      );
      render(<AskPage />, { wrapper });
      await userEvent.type(screen.getByRole("textbox"), "anything");
      await userEvent.click(screen.getByRole("button", { name: /ask/i }));
      await waitFor(() =>
        expect(
          screen.getByText(
            "AWS docs search unavailable — showing related docs from our graph."
          )
        ).toBeInTheDocument()
      );
    });

    it("shows Neo4j unavailable banner when neo4j_unavailable=true", async () => {
      server.use(
        http.post(`${API_BASE}/v1/queries`, () =>
          HttpResponse.json(FIXTURE_QUERY_NEO4J_DOWN)
        )
      );
      render(<AskPage />, { wrapper });
      await userEvent.type(screen.getByRole("textbox"), "anything");
      await userEvent.click(screen.getByRole("button", { name: /ask/i }));
      await waitFor(() =>
        expect(
          screen.getByText("Related-doc suggestions temporarily unavailable.")
        ).toBeInTheDocument()
      );
    });

    it("shows synthesis failed banner when synthesis_failed=true", async () => {
      server.use(
        http.post(`${API_BASE}/v1/queries`, () =>
          HttpResponse.json(FIXTURE_QUERY_SYNTHESIS_FAILED)
        )
      );
      render(<AskPage />, { wrapper });
      await userEvent.type(screen.getByRole("textbox"), "anything");
      await userEvent.click(screen.getByRole("button", { name: /ask/i }));
      await waitFor(() =>
        expect(
          screen.getByText(
            "Couldn't generate written answer; here are the most relevant pages."
          )
        ).toBeInTheDocument()
      );
    });
  });

  describe("AskPage — error state", () => {
    it("shows error message when API returns 500", async () => {
      server.use(
        http.post(`${API_BASE}/v1/queries`, () =>
          HttpResponse.json({ error: "internal server error" }, { status: 500 })
        )
      );
      render(<AskPage />, { wrapper });
      await userEvent.type(screen.getByRole("textbox"), "anything");
      await userEvent.click(screen.getByRole("button", { name: /ask/i }));
      await waitFor(() =>
        expect(screen.getByText(/something went wrong/i)).toBeInTheDocument()
      );
    });
  });
  ```

- [ ] **Step 2: Run tests — expect FAIL**

  ```bash
  cd /path/to/aws-docs-graph/web
  npx vitest run tests/pages/ask.test.tsx
  ```

  Expected: FAIL — module not found.

- [ ] **Step 3: Implement `web/app/ask/page.tsx`**

  ```typescript
  "use client";

  import { useState } from "react";
  import { QueryForm } from "@/components/QueryForm";
  import { AnswerPanel } from "@/components/AnswerPanel";
  import { CitationsPanel } from "@/components/CitationsPanel";
  import { RelatedDocsPanel } from "@/components/RelatedDocsPanel";
  import { DegradedBanner, type DegradedVariant } from "@/components/DegradedBanner";
  import { useSubmitQuery } from "@/lib/api";
  import type { QueryResponse } from "@/lib/types";

  function degradedVariant(
    metadata: QueryResponse["metadata"]
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
        }
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
  ```

- [ ] **Step 4: Run tests — expect PASS**

  ```bash
  cd /path/to/aws-docs-graph/web
  npx vitest run tests/pages/ask.test.tsx
  ```

  Expected: 8 tests pass.

- [ ] **Step 5: Commit**

  ```bash
  git add web/app/ask/page.tsx web/tests/pages/ask.test.tsx
  git commit -m "feat(web): add /ask page with question form, answer, citations, related docs, degraded banners"
  ```

---

### Task 14: History, Query Detail, Graph, and Account pages

**Files:**
- Create: `web/app/history/page.tsx`
- Create: `web/app/queries/[id]/page.tsx`
- Create: `web/app/graph/page.tsx`
- Create: `web/app/account/page.tsx`

**Interfaces:**
- History: uses `useQueryHistory`, renders list of past questions with link to detail
- Query detail: uses `useQueryDetail(id)`, renders full `AnswerPanel` + `CitationsPanel` + `RelatedDocsPanel`
- Graph: uses `useGraphOverview`, renders `GraphCanvas` (stub) with loading/error state
- Account: uses `useMe`, renders display name + daily cost

- [ ] **Step 1: Create `web/app/history/page.tsx`**

  ```typescript
  "use client";

  import Link from "next/link";
  import { useQueryHistory } from "@/lib/api";

  export default function HistoryPage() {
    const { data, isLoading, isError } = useQueryHistory();

    if (isLoading) return <main style={{ padding: 32 }}><p>Loading…</p></main>;
    if (isError) return <main style={{ padding: 32 }}><p style={{ color: "#c00" }}>Failed to load history.</p></main>;

    return (
      <main style={{ maxWidth: 820, margin: "40px auto", padding: "0 16px" }}>
        <h1 style={{ fontSize: 24, marginBottom: 20 }}>Query History</h1>
        {data?.queries.length === 0 && (
          <p style={{ color: "#888" }}>No queries yet. <Link href="/ask">Ask your first question.</Link></p>
        )}
        <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
          {data?.queries.map((q) => (
            <li
              key={q.id}
              style={{
                marginBottom: 12,
                padding: 14,
                background: "#fff",
                borderRadius: 6,
                border: "1px solid #e8e8e8",
              }}
            >
              <Link
                href={`/queries/${q.id}`}
                style={{ color: "#0070f3", fontWeight: 600, textDecoration: "none" }}
              >
                {q.question}
              </Link>
              <span style={{ color: "#aaa", fontSize: 13, marginLeft: 12 }}>
                {new Date(q.created_at).toLocaleString()}
              </span>
            </li>
          ))}
        </ul>
      </main>
    );
  }
  ```

- [ ] **Step 2: Create `web/app/queries/[id]/page.tsx`**

  ```typescript
  "use client";

  import { use } from "react";
  import { AnswerPanel } from "@/components/AnswerPanel";
  import { CitationsPanel } from "@/components/CitationsPanel";
  import { RelatedDocsPanel } from "@/components/RelatedDocsPanel";
  import { DegradedBanner, type DegradedVariant } from "@/components/DegradedBanner";
  import { useQueryDetail } from "@/lib/api";
  import type { QueryResponse } from "@/lib/types";

  function degradedVariant(
    metadata: QueryResponse["metadata"]
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

    if (isLoading) return <main style={{ padding: 32 }}><p>Loading…</p></main>;
    if (isError || !data) return <main style={{ padding: 32 }}><p style={{ color: "#c00" }}>Query not found.</p></main>;

    return (
      <main style={{ maxWidth: 820, margin: "40px auto", padding: "0 16px" }}>
        <h1 style={{ fontSize: 22, marginBottom: 20 }}>{data.question}</h1>

        <DegradedBanner variant={degradedVariant(data.metadata)} />

        <section style={{ marginBottom: 32 }}>
          <h2 style={{ fontSize: 18, marginBottom: 12 }}>Answer</h2>
          <AnswerPanel answer={data.answer} citationCount={data.citations.length} />
        </section>

        <section style={{ marginBottom: 32 }}>
          <h2 style={{ fontSize: 18, marginBottom: 12 }}>Citations ({data.citations.length})</h2>
          <CitationsPanel citations={data.citations} />
        </section>

        <section>
          <h2 style={{ fontSize: 18, marginBottom: 12 }}>Related Docs ({data.related_docs.length})</h2>
          <RelatedDocsPanel relatedDocs={data.related_docs} />
        </section>
      </main>
    );
  }
  ```

- [ ] **Step 3: Create `web/app/graph/page.tsx`**

  ```typescript
  "use client";

  import { GraphCanvas } from "@/components/GraphCanvas";
  import { useGraphOverview } from "@/lib/api";
  import type { GraphNode } from "@/lib/types";

  export default function GraphPage() {
    const { data, isLoading, isError } = useGraphOverview();

    if (isLoading) return <main style={{ padding: 32 }}><p>Loading graph…</p></main>;
    if (isError) return <main style={{ padding: 32 }}><p style={{ color: "#c00" }}>Failed to load graph.</p></main>;

    function handleNodeClick(node: GraphNode) {
      // Day 9: navigate to /graph/[id] for drill-down
      console.log("Node clicked:", node.id);
    }

    return (
      <main>
        <div style={{ padding: "16px 24px", borderBottom: "1px solid #eee" }}>
          <h1 style={{ fontSize: 22, margin: 0 }}>AWS Docs Graph</h1>
          <p style={{ color: "#888", fontSize: 14, margin: "4px 0 0" }}>
            {data?.nodes.length ?? 0} documents · click a node to explore
          </p>
        </div>
        {data && (
          <GraphCanvas
            nodes={data.nodes}
            edges={data.edges}
            onNodeClick={handleNodeClick}
            width={typeof window !== "undefined" ? window.innerWidth : 1200}
            height={typeof window !== "undefined" ? window.innerHeight - 80 : 700}
          />
        )}
      </main>
    );
  }
  ```

- [ ] **Step 4: Create `web/app/account/page.tsx`**

  ```typescript
  "use client";

  import { useMe } from "@/lib/api";

  export default function AccountPage() {
    const { data, isLoading, isError } = useMe();

    if (isLoading) return <main style={{ padding: 32 }}><p>Loading…</p></main>;
    if (isError) return <main style={{ padding: 32 }}><p style={{ color: "#c00" }}>Failed to load account.</p></main>;

    return (
      <main style={{ maxWidth: 500, margin: "40px auto", padding: "0 16px" }}>
        <h1 style={{ fontSize: 24, marginBottom: 24 }}>Account</h1>
        <dl style={{ margin: 0 }}>
          <dt style={{ fontWeight: 600, color: "#555", fontSize: 13 }}>Display name</dt>
          <dd style={{ margin: "4px 0 16px", fontSize: 16 }}>
            {data?.display_name ?? <span style={{ color: "#aaa" }}>Not set</span>}
          </dd>
          <dt style={{ fontWeight: 600, color: "#555", fontSize: 13 }}>Daily cost today</dt>
          <dd style={{ margin: "4px 0", fontSize: 16 }}>
            ${data?.daily_cost_usd.toFixed(4)} <span style={{ color: "#aaa", fontSize: 13 }}>/ $0.50 cap</span>
          </dd>
        </dl>
      </main>
    );
  }
  ```

- [ ] **Step 5: Create `web/components/NodeDetailPanel.tsx` (stub)**

  Full implementation is Day 9. This stub satisfies the component import path and renders basic node metadata.

  ```typescript
  import type { GraphNode } from "@/lib/types";

  interface Props {
    node: GraphNode;
  }

  export function NodeDetailPanel({ node }: Props) {
    return (
      <div
        style={{
          padding: 16,
          background: "#fff",
          border: "1px solid #e8e8e8",
          borderRadius: 6,
        }}
      >
        <h3 style={{ margin: "0 0 8px", fontSize: 16 }}>
          {node.title ?? node.url}
        </h3>
        {node.service && (
          <span
            style={{
              display: "inline-block",
              background: "#e8f0fe",
              color: "#1a73e8",
              borderRadius: 3,
              padding: "1px 6px",
              fontSize: 12,
              marginBottom: 8,
            }}
          >
            {node.service}
          </span>
        )}
        <p style={{ margin: 0, fontSize: 13 }}>
          <a href={node.url} target="_blank" rel="noreferrer" style={{ color: "#0070f3" }}>
            {node.url}
          </a>
        </p>
      </div>
    );
  }
  ```

- [ ] **Step 6: Verify TypeScript compiles**

  ```bash
  cd /path/to/aws-docs-graph/web
  npx tsc --noEmit
  ```

  Expected: exits 0.

- [ ] **Step 7: Commit**

  ```bash
  git add web/app/history/page.tsx web/app/queries/ web/app/graph/page.tsx web/app/account/page.tsx web/components/NodeDetailPanel.tsx
  git commit -m "feat(web): add history, query detail, graph stub, account pages, and NodeDetailPanel stub"
  ```

---

### Task 15: CI — lint-web + test-web jobs

**Files:**
- Modify: `.github/workflows/ci.yml`
- Create: `web/.eslintrc.json`

**Interfaces:**
- Produces: `lint-web` job (ESLint via `next lint`) and `test-web` job (Vitest) added to CI; both run in parallel with existing jobs

- [ ] **Step 1: Create `web/.eslintrc.json`**

  ```json
  {
    "extends": ["next/core-web-vitals", "next/typescript"]
  }
  ```

- [ ] **Step 2: Read current CI file**

  Read `/path/to/aws-docs-graph/.github/workflows/ci.yml` before editing it.

- [ ] **Step 3: Replace CI with full parallel jobs**

  Replace the contents of `.github/workflows/ci.yml`:

  ```yaml
  name: CI

  on:
    push:
      branches: [main]
    pull_request:

  jobs:
    lint-python:
      runs-on: ubuntu-latest
      steps:
        - uses: actions/checkout@v4
        - uses: actions/setup-python@v5
          with:
            python-version: "3.12"
        - run: pip install ruff==0.4.4
        - run: ruff check agent-service/

    test-python:
      runs-on: ubuntu-latest
      steps:
        - uses: actions/checkout@v4
        - uses: actions/setup-python@v5
          with:
            python-version: "3.12"
        - run: pip install -r agent-service/requirements.txt -r agent-service/requirements-dev.txt
        - run: pytest agent-service/tests/ -v
          env:
            DATABASE_URL: ""
            NEO4J_URI: ""
            NEO4J_USERNAME: ""
            NEO4J_PASSWORD: ""

    lint-web:
      runs-on: ubuntu-latest
      defaults:
        run:
          working-directory: web
      steps:
        - uses: actions/checkout@v4
        - uses: actions/setup-node@v4
          with:
            node-version: "22"
            cache: "npm"
            cache-dependency-path: web/package-lock.json
        - run: npm ci
        - run: npm run lint

    test-web:
      runs-on: ubuntu-latest
      defaults:
        run:
          working-directory: web
      steps:
        - uses: actions/checkout@v4
        - uses: actions/setup-node@v4
          with:
            node-version: "22"
            cache: "npm"
            cache-dependency-path: web/package-lock.json
        - run: npm ci
        - run: npm test
          env:
            NEXT_PUBLIC_API_URL: "http://localhost:8080"
            NEXT_PUBLIC_SUPABASE_URL: "http://localhost:54321"
            NEXT_PUBLIC_SUPABASE_ANON_KEY: "test-anon-key"

    terraform-validate:
      runs-on: ubuntu-latest
      steps:
        - uses: actions/checkout@v4
        - uses: hashicorp/setup-terraform@v3
        - run: terraform -chdir=infra fmt -check -recursive
        - run: terraform -chdir=infra/envs/prod validate || true

    secret-scan:
      runs-on: ubuntu-latest
      steps:
        - uses: actions/checkout@v4
          with:
            fetch-depth: 0
        - uses: gitleaks/gitleaks-action@v2
          env:
            GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
  ```

- [ ] **Step 4: Commit**

  ```bash
  git add .github/workflows/ci.yml web/.eslintrc.json
  git commit -m "ci: add lint-web and test-web jobs to CI pipeline"
  ```

---

### Task 16: Vercel deployment

**Files:**
- Create: `web/vercel.json`

**Interfaces:**
- Produces: `web/vercel.json` marking root directory as `web`; deployment instructions for environment variables

- [ ] **Step 1: Create `web/vercel.json`**

  ```json
  {
    "framework": "nextjs",
    "buildCommand": "npm run build",
    "installCommand": "npm ci",
    "outputDirectory": ".next"
  }
  ```

- [ ] **Step 2: Set Vercel project settings**

  In the Vercel dashboard (https://vercel.com/dashboard):

  1. Go to Project → Settings → General → Root Directory — set to `web`
  2. Go to Project → Settings → Environment Variables — add all three for Production:
     - `NEXT_PUBLIC_API_URL` = `https://api.yourdomain.com` (your API Gateway URL)
     - `NEXT_PUBLIC_SUPABASE_URL` = your Supabase project URL (from Supabase dashboard → Settings → API)
     - `NEXT_PUBLIC_SUPABASE_ANON_KEY` = your Supabase anon key (same page)
  3. Redeploy (or push to `main` to trigger auto-deploy)

- [ ] **Step 3: Verify build passes locally**

  ```bash
  cd /path/to/aws-docs-graph/web
  npm run build
  ```

  Expected: `✓ Compiled successfully`, no TypeScript errors, `.next/` produced.

- [ ] **Step 4: Commit**

  ```bash
  git add web/vercel.json
  git commit -m "feat(web): add vercel.json for Vercel hobby deployment"
  ```

---

### Task 17: Run all tests — full suite pass

**Files:** no new files

- [ ] **Step 1: Run all web tests**

  ```bash
  cd /path/to/aws-docs-graph/web
  npm test
  ```

  Expected output (all passing):
  ```
  ✓ tests/lib/api.test.tsx (4)
  ✓ tests/components/DegradedBanner.test.tsx (4)
  ✓ tests/components/AnswerPanel.test.tsx (3)
  ✓ tests/components/CitationsPanel.test.tsx (6)
  ✓ tests/components/RelatedDocsPanel.test.tsx (5)
  ✓ tests/components/QueryForm.test.tsx (5)
  ✓ tests/components/GraphCanvas.test.tsx (3)
  ✓ tests/pages/login.test.tsx (4)
  ✓ tests/pages/ask.test.tsx (8)

  Test Files  9 passed (9)
  Tests       42 passed (42)
  ```

- [ ] **Step 2: Run TypeScript check**

  ```bash
  cd /path/to/aws-docs-graph/web
  npx tsc --noEmit
  ```

  Expected: exits 0.

- [ ] **Step 3: Run lint**

  ```bash
  cd /path/to/aws-docs-graph/web
  npm run lint
  ```

  Expected: no errors.

- [ ] **Step 4: Push to main and verify CI is green**

  ```bash
  git push origin main
  ```

  Wait for GitHub Actions. Navigate to Actions tab — all jobs (`lint-web`, `test-web`, `lint-python`, `terraform-validate`, `secret-scan`) should show green checkmarks.

---

## Gate Check

**Day 8 is complete when:**

1. A signed-in user can visit the Vercel-deployed URL, log in with email+password, type a question at `/ask`, and see an answer with citations and related docs rendered in the browser.
2. All 42 Vitest tests pass locally (`npm test` in `web/`).
3. `lint-web` and `test-web` CI jobs are green on `main`.
4. The three degraded banner variants each render correctly (verified by test).
5. TypeScript compiles with zero errors (`npx tsc --noEmit`).
