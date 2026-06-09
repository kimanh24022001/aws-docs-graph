# AWS Docs Knowledge Graph — Phase 1 Design

**Status:** Design — pending user approval before implementation planning
**Date:** 2026-06-04
**Author:** Brainstorm session (user + Claude)
**Implementation plan:** TBD (will be produced by `writing-plans` skill after approval)

---

## 1. Goal

Build a small-team AWS documentation assistant that practices the full software development lifecycle (frontend, API gateway, backend, persistence, deploy, CI/CD). The assistant answers natural-language questions about AWS using a hybrid of vector retrieval (via the AWS Knowledge MCP server) and a knowledge graph (one node per AWS doc URL, edges representing structural and behavioral relatedness). The project is explicitly a learning vehicle — design choices favor *teaching the SDLC properly* over delivering the fastest possible implementation.

**Phase 1 success criteria:**

- A signed-in user can ask a question and receive an answer with citations to specific AWS doc URLs.
- The answer includes a "related docs" panel populated by graph traversal.
- A graph atlas view renders the AWS docs corpus as a force-directed graph in the style of standard knowledge-graph visualizers.
- Background ingestion keeps the graph current with weekly cadence.
- Authentication, authorization, observability, cost guardrails, and CI/CD are all in place.
- Cost stays under ~$10/month at small-team usage.

**Explicitly out of scope for phase 1 (deferred to phase 2):**

- Personal browsing graph (the user's own visit history layered on top of the AWS docs graph)
- Open multi-tenant signup with org switching
- Streaming responses
- Async/long-running query path
- Conversational follow-ups (thread model)
- E2E tests in CI
- Per-query subgraph "explainer" view
- LLM-driven concept extraction over and above structural edges

The data model and architecture are designed so each deferred item is **additive**, not a rewrite.

---

## 2. Decisions captured during brainstorming

| Topic | Choice | Rationale |
|---|---|---|
| Primary goal | Learning vehicle (full SDLC practice) | User's stated objective |
| Domain | AWS docs assistant | Small, concrete starting point |
| Auth scope | Small team (B), designed for B→C migration | Practice real auth + tenant isolation cheaply |
| Query style | C-lite — graph as enrichment over vector RAG | Best balance of value, learning, and implementation cost |
| Graph node model | One `:Document` node per AWS doc URL | User-corrected; matches the reference visualization expectation |
| Graph edges (phase 1) | `LINKS_TO`, `PREV_NEXT`, `CO_RETURNED` | Derivable from data we already produce; no LLM extraction needed |
| Color scheme | Color = AWS service | Matches reference image style |
| Frontend | TypeScript + Next.js (App Router) | Industry standard, integrates with Supabase |
| FE host | Vercel free hobby tier | Simplest deploy; cost = $0 |
| API gateway | AWS API Gateway REST | Required by user's "AWS cloud + API gateway" theme |
| Auth | Supabase Auth (JWT) + Lambda Authorizer | Single user identity source; standard pattern |
| API service | Java Spring Boot 3 on Lambda + SnapStart | User language preference; SnapStart eliminates cold-start cost |
| API service architecture | Hexagonal (domain / application / adapter) | Maximizes SDLC practice value |
| Agent service | Python FastAPI on Lambda (container) | Best LLM/agent ecosystem |
| Agent service public surface | None — IAM SigV4 only, internal calls | Minimum public attack surface |
| Internal service-to-service auth | AWS IAM SigV4 (Lambda Function URL with `AuthType=AWS_IAM`) | No shared secrets; CloudTrail audit; native AWS pattern |
| Postgres + pgvector | Supabase (free tier) | Generous free tier, RLS, hosted |
| Graph DB | Neo4j AuraDB Free | Real Cypher experience; no `pgvector`/Apache AGE compromises |
| Object storage | S3 deferred — not provisioned in phase 1 | We don't need to keep raw HTML; AWS owns content |
| Agent orchestration | LangGraph, deterministic linear graph | Predictable, debuggable, cheap |
| Compute | AWS Lambda (Java SnapStart, Python container) | $0 forever-free at small scale; no Fargate needed in phase 1 |
| Ingestion cadence | Weekly cron + manual `POST /internal/ingest/bootstrap` | AWS docs change infrequently; weekly is sufficient |
| Per-run ingestion cap | 2,000 URLs/run | Fits one Lambda invocation; full corpus diff in one run |
| Build vs buy for retrieval | Buy — call AWS Knowledge MCP server (`https://knowledge-mcp.global.api.aws`) | AWS already publishes a free, no-auth retrieval surface that's better than what we'd build |
| Query response style | Sync; 28s Java / 25s Python under 30s gateway timeout | Simpler in phase 1; clear escape hatch to async in phase 2 |
| Atlas view cap | Top 2,000 docs by degree centrality | Single-page wow without hairball |
| Degraded mode | Graph-only response with banner if MCP fails | Honest, partial value |
| CI/CD | GitHub Actions, mono-repo, Terraform | Industry-standard skills |
| Environments (phase 1) | local + prod (dev TBD/skipped) | Simple solo workflow; multi-env-ready Terraform |
| IaC | Terraform | Cross-cloud, transferable, mature |
| Local Java dev | WireMock for Python service | Fully offline development |
| Edge / DNS | Cloudflare DNS + proxy + free TLS, added in phase-1 hardening sprint | Edge protection without phase-1 distraction |
| Hostnames | `yourdomain.com` (FE) + `api.yourdomain.com` (backend) | Clean separation; no FE-side proxy code |
| TLS posture | AWS ACM cert + Cloudflare "Full (strict)" | Standard AWS workflow; revisit Origin Cert in phase 2 |
| Per-user daily LLM cost cap | $0.50/day | Bounds blast radius without being annoying |
| Cost ceiling (overall) | $10/month, hard-capped by AWS Budgets + Anomaly Detection | User constraint |
| Test scope (phase 1) | Unit + integration (Testcontainers); ArchUnit for hexagonal; cost-regression script | E2E deferred |

---

## 3. System architecture

### 3.1 Logical architecture

```
                      ┌─────────────────────────────────────────────────────┐
                      │  USER (browser, authenticated via Supabase Auth)    │
                      └─────────────────────────┬───────────────────────────┘
                                                │ HTTPS, JWT
                                                ▼
                      ┌─────────────────────────────────────────────────────┐
                      │  Next.js FE (Vercel)                                │
                      │  Pages: /login /ask /history /queries/[id]          │
                      │         /graph /graph/[id] /account                 │
                      └─────────────────────────┬───────────────────────────┘
                                                │
                                                ▼
                      ┌─────────────────────────────────────────────────────┐
                      │  AWS API Gateway (REST) + Lambda Authorizer         │
                      │  Validates Supabase JWT against JWKS                │
                      │  Throttles, routes everything to Java api-service   │
                      └─────────────────────────┬───────────────────────────┘
                                                │
                                                ▼
       ┌────────────────────────────────────────────────────────────────────────────┐
       │  Java api-service (Spring Boot 3, hexagonal, Lambda + SnapStart)          │
       │  Endpoints:                                                                │
       │    POST /v1/queries          GET /v1/queries  GET /v1/queries/{id}         │
       │    GET  /v1/graph/overview   GET /v1/graph/documents/{id}/neighbors        │
       │    GET  /v1/graph/search     GET /v1/me       GET /v1/healthz              │
       │  Owns: REST, AuthZ, Postgres+Neo4j reads, idempotency, response shaping    │
       │  Calls Python over IAM SigV4 + signs outbound to Function URL              │
       └────────────────┬───────────────────────────────────────┬───────────────────┘
                        │ SigV4 (IAM)                            │ SQL/Cypher (read)
                        ▼                                        ▼
       ┌─────────────────────────────────┐      ┌──────────────────────────────────┐
       │  Python agent-service           │      │  Supabase Postgres               │
       │  (FastAPI on Lambda container)  │      │  - app schema (users, queries,   │
       │  Internal endpoints:            │      │    documents, llm_calls, ...)    │
       │    /internal/agents/run         │      │  - RLS on user-scoped tables     │
       │    /internal/ingest/page        │      │  - Connection via dedicated DB   │
       │    /internal/ingest/sitemap     │      │    users (Java + Python)         │
       │    /internal/ingest/bootstrap   │      └──────────────────────────────────┘
       │    /internal/graph/co-returned  │      ┌──────────────────────────────────┐
       │  Function URL AuthType=AWS_IAM  │      │  Neo4j AuraDB Free               │
       │  Owns: LLM, MCP, ingest writes  │      │  Document nodes + LINKS_TO,      │
       └─────┬───────┬────────┬──────────┘      │  PREV_NEXT, CO_RETURNED edges    │
             │       │        │                  └──────────────────────────────────┘
             ▼       ▼        ▼
   ┌──────────────────┐ ┌──────────────────┐ ┌─────────────────────────┐
   │ AWS Knowledge    │ │ Anthropic API    │ │ Postgres / Neo4j writes │
   │ MCP (no auth)    │ │ (Claude 4.5/4.6) │ │ + idempotency           │
   │ Streamable HTTP  │ └──────────────────┘ └─────────────────────────┘
   └──────────────────┘

       ┌──────────────────────────────────────────────────────────────────────────┐
       │  EventBridge — Mondays 02:00 UTC weekly                                  │
       │  → ingest-cron Lambda → Python /internal/ingest/sitemap (cap 2000 URLs)  │
       └──────────────────────────────────────────────────────────────────────────┘

       ┌──────────────────────────────────────────────────────────────────────────┐
       │  Cross-cutting:                                                          │
       │   - Secrets: AWS Parameter Store (SecureString)                          │
       │   - Logs:    CloudWatch (14d retention via Terraform)                    │
       │   - Traces:  AWS X-Ray (gateway → Java → Python → external)              │
       │   - Metrics: CloudWatch EMF (cost, latency, queries/min, MCP health)     │
       │   - Alarms:  email via SNS                                               │
       │   - Cost:    Budgets ($10/mo), Anomaly Detection ($5)                    │
       │   - Tags:    project=aws-docs-graph, env=local|prod                      │
       └──────────────────────────────────────────────────────────────────────────┘
```

### 3.2 Architectural principles

1. **Java is the only public surface.** Python is internal; only callable via IAM SigV4 from inside our AWS account.
2. **Three persistence stores, one writer per store.** Postgres is the source of truth for "documents exist + metadata." Neo4j is the source of truth for "how documents connect." Postgres → Neo4j writes happen only in Python ingestion paths. Java only reads from Neo4j.
3. **Multi-tenant-ready from row 1.** Every user-scoped table has `user_id NOT NULL` and `org_id NOT NULL`. Phase 2 multi-tenancy is additive — no migrations or RLS rewrites.
4. **Idempotency at every async boundary.** All ingestion endpoints accept idempotency keys; all writes use `ON CONFLICT` (Postgres) and `MERGE` (Cypher).
5. **Bounded LLM behavior.** LangGraph is deterministic and linear; per-step token budgets; per-run wall-clock budget; per-user daily $ cap.
6. **Observability is not optional.** Every Lambda emits structured JSON logs + CloudWatch EMF metrics + X-Ray sub-segments. Daily LLM cost is a first-class metric.
7. **Cost guardrails are layered.** AWS Budget + Anomaly Detection + per-user app-level cap + outbound concurrency limits + Anthropic console cap. Each independent.

---

## 4. Components

### 4.1 Frontend `web` (Next.js + TypeScript)

- **Host:** Vercel hobby tier
- **Pages:** `/`, `/login`, `/ask`, `/history`, `/queries/[id]`, `/graph`, `/graph/[id]`, `/account`
- **Auth:** Supabase Auth client SDK (httpOnly cookies)
- **Data:** TanStack Query against `https://api.<domain>` with `Authorization: Bearer <jwt>`
- **Graph viewer:** `react-force-graph-2d` (force-directed, color-by-service)
- **Owns:** Auth session, presentation, data fetching
- **Does NOT own:** Direct DB access (Supabase client used only for auth, never for data reads/writes)

### 4.2 API Gateway `gateway` (AWS API Gateway REST)

- **Lambda Authorizer:** validates Supabase JWT against JWKS, injects `userId` + `email` into request context, caches authorization decisions for 300s
- **Throttling:** 10 req/s, 1000 req/day per principal
- **Single integration:** Java api-service Lambda
- **CORS:** restricted allow-list (production hostname + Vercel preview origins)
- **TLS:** ACM cert (added during phase-1 hardening when custom domain attached)

### 4.3 Java api-service (Spring Boot 3, Lambda + SnapStart, hexagonal)

| Endpoint | Purpose |
|---|---|
| `GET /v1/healthz` | Liveness |
| `POST /v1/queries` | Submit a question (idempotent via `Idempotency-Key`) |
| `GET /v1/queries/{id}` | Fetch a single query |
| `GET /v1/queries` | Paginated history |
| `GET /v1/graph/overview` | Atlas view (cached materialized view) |
| `GET /v1/graph/documents/{id}` | Single document detail |
| `GET /v1/graph/documents/{id}/neighbors?hops=1` | Drill-down neighborhood |
| `GET /v1/graph/search?q=...` | Document search by title/URL |
| `GET /v1/me` | Caller profile |

**Ownership:**
- All public-facing business logic, AuthZ checks, idempotency
- Reads Postgres `users`, `queries`, `query_citations`, `query_related_docs`, `documents`
- Read-only Cypher against Neo4j
- Outbound: SigV4-signed POSTs to Python service

**Architecture (hexagonal):**
```
api-service/src/main/java/com/awsdocs/
  domain/              — entities, value objects, NO framework imports
  application/         — use cases, ports (interfaces)
  adapter/in/rest/     — @RestController, DTOs, request validation
  adapter/out/persistence/  — Postgres repos, Flyway migrations
  adapter/out/agent/   — SigV4 client to Python
  adapter/out/graph/   — Neo4j read client
  infrastructure/      — Spring config, Lambda handler shim
```

**ArchUnit rules** (enforced in CI):
- `domain` depends on no other project package
- `application` depends only on `domain`
- `adapter.in` never depends on `adapter.out`
- No JPA / framework annotations in `domain`

### 4.4 Python agent-service (FastAPI, Lambda container, internal-only)

| Endpoint | Purpose |
|---|---|
| `GET /internal/healthz` | Liveness |
| `POST /internal/agents/run` | Run LangGraph for a question |
| `POST /internal/ingest/sitemap` | Sitemap walk + diff + per-run-cap enqueue |
| `POST /internal/ingest/page` | Single-URL idempotent ingestion |
| `POST /internal/ingest/bootstrap` | One-time uncapped initial fill |
| `POST /internal/graph/co-returned` | Periodic CO_RETURNED edge maintenance |

**Ownership:**
- All Anthropic API calls (single chokepoint for cost)
- All AWS Knowledge MCP calls (single chokepoint for retrieval)
- All HTML structure extraction
- All writes to Postgres `documents`, `crawl_log`, `mcp_search_log`, `llm_calls`, `agent_runs`, `idempotency_keys` (ingest)
- All writes to Neo4j (Cypher MERGE)
- LangGraph state machines

**Lambda config:** 2048 MB memory, 5-minute timeout, reserved concurrency 5 (dev) / 10 (prod), Function URL `AuthType=AWS_IAM`.

**Resilience:**
- MCP retry: exponential backoff with jitter on 429/5xx, max 2 attempts
- Circuit breaker: opens after 5 consecutive MCP failures, recovers after 60s
- 24h MCP result cache in Postgres `app.mcp_cache`
- Hard token budget per agent run: 50K tokens, partial-answer-with-warning on overrun

### 4.5 Ingestion Trigger `ingest-cron` (EventBridge + tiny invoker Lambda)

- EventBridge rule: `cron(0 2 ? * MON *)` — Mondays 02:00 UTC
- Invokes Python `/internal/ingest/sitemap` over SigV4
- Python service applies the 2,000-URL/run cap
- Resumable via `app.crawl_cursor`

### 4.6 External integration — AWS Knowledge MCP Server

- Endpoint: `https://knowledge-mcp.global.api.aws`
- Transport: MCP Streamable HTTP
- Auth: none required
- Caller: only Python `agent-service`
- Tools used: `search_documentation`, `read_documentation`

---

## 5. Data model

All app tables live in the `app` Postgres schema (separated from Supabase's `auth` schema). Migrations via Flyway.

### 5.1 Identity & multi-tenancy primitives

```sql
create table app.users (
  id          uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  role        text not null default 'member' check (role in ('member', 'admin')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table app.organizations (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  slug        text unique not null,
  is_personal boolean not null default true,
  created_at  timestamptz not null default now()
);

create table app.org_memberships (
  org_id      uuid not null references app.organizations(id) on delete cascade,
  user_id     uuid not null references app.users(id) on delete cascade,
  role        text not null default 'member' check (role in ('owner', 'admin', 'member')),
  joined_at   timestamptz not null default now(),
  primary key (org_id, user_id)
);
```

In phase 1, every new user is auto-assigned to a "personal org" of size 1 (`is_personal=true`). Phase 2 adds real orgs without schema or RLS changes.

### 5.2 Documents (canonical, global, no per-user scope)

```sql
create table app.documents (
  id              uuid primary key default gen_random_uuid(),
  url             text unique not null,
  url_hash        text not null,
  title           text,
  service         text,
  guide           text,
  toc_path        text[],
  language        text default 'en',
  word_count      int,
  hash            text not null,
  first_seen_at   timestamptz not null default now(),
  last_crawled_at timestamptz not null default now(),
  last_changed_at timestamptz not null default now(),
  status          text not null default 'active' check (status in ('active', 'gone', 'redirected')),
  redirect_to     uuid references app.documents(id),
  metadata        jsonb not null default '{}'
);

create index documents_service_idx        on app.documents(service);
create index documents_url_hash_idx       on app.documents(url_hash);
create index documents_last_crawled_idx   on app.documents(last_crawled_at);
create index documents_status_idx         on app.documents(status);
```

Notably absent: `chunks` table and pgvector embeddings. Retrieval is delegated to the AWS Knowledge MCP server.

### 5.3 Queries & results

```sql
create table app.queries (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references app.users(id),
  org_id            uuid not null references app.organizations(id),
  thread_id         uuid,                                    -- nullable in phase 1, used in phase 2
  question          text not null,
  question_hash     text not null,
  status            text not null default 'pending'
                       check (status in ('pending', 'running', 'succeeded', 'failed', 'cancelled')),
  answer            text,
  agent_run_id      uuid,
  duration_ms       int,
  total_cost_usd    numeric(10,6),
  total_tokens_in   int,
  total_tokens_out  int,
  error_code        text,
  error_message     text,
  idempotency_key   text,
  created_at        timestamptz not null default now(),
  completed_at      timestamptz
);

create index queries_user_id_created_idx   on app.queries(user_id, created_at desc);
create index queries_org_id_created_idx    on app.queries(org_id, created_at desc);
create unique index queries_idempotency_idx
  on app.queries(user_id, idempotency_key) where idempotency_key is not null;

create table app.query_citations (
  query_id     uuid not null references app.queries(id) on delete cascade,
  document_id  uuid not null references app.documents(id),
  rank         int  not null,
  score        real,
  snippet      text,
  source_kind  text not null check (source_kind in ('mcp_search', 'graph_traversal')),
  primary key (query_id, document_id, source_kind)
);

create table app.query_related_docs (
  query_id     uuid not null references app.queries(id) on delete cascade,
  document_id  uuid not null references app.documents(id),
  hop_count    int  not null default 1,
  edge_path    text[],
  primary key (query_id, document_id)
);
```

**RLS** on all user-scoped tables, e.g.:

```sql
alter table app.queries enable row level security;

create policy queries_user_isolation on app.queries
  for all
  using (
    org_id in (
      select org_id from app.org_memberships where user_id = auth.uid()
    )
  );
```

Same shape for `query_citations` and `query_related_docs` (joined through `queries`).

### 5.4 Agent runs, LLM cost telemetry, MCP audit

```sql
create table app.agent_runs (
  id              uuid primary key default gen_random_uuid(),
  query_id        uuid not null references app.queries(id) on delete cascade,
  user_id         uuid not null references app.users(id),
  org_id          uuid not null references app.organizations(id),
  status          text not null default 'running'
                    check (status in ('running', 'succeeded', 'failed', 'budget_exceeded')),
  started_at      timestamptz not null default now(),
  finished_at     timestamptz,
  graph_state     jsonb not null default '{}',
  step_log        jsonb not null default '[]'
);

create table app.llm_calls (
  id              uuid primary key default gen_random_uuid(),
  query_id        uuid references app.queries(id) on delete set null,
  agent_run_id    uuid references app.agent_runs(id) on delete set null,
  source          text not null,    -- 'agent_synthesis' | 'agent_planning' | 'ingest_extraction'
  provider        text not null,
  model           text not null,
  prompt_cache_hit boolean,
  input_tokens    int,
  output_tokens   int,
  cost_usd        numeric(10,6),
  latency_ms      int,
  created_at      timestamptz not null default now()
);

create table app.mcp_search_log (
  id               uuid primary key default gen_random_uuid(),
  query_id         uuid references app.queries(id) on delete set null,
  agent_run_id     uuid references app.agent_runs(id) on delete set null,
  tool_name        text not null,
  input            jsonb not null,
  result_summary   jsonb,
  status           text not null check (status in ('ok', 'rate_limited', 'error', 'timeout')),
  http_status      int,
  latency_ms       int,
  created_at       timestamptz not null default now()
);

create table app.mcp_cache (
  cache_key       text primary key,
  tool_name       text not null,
  input           jsonb not null,
  result          jsonb not null,
  expires_at      timestamptz not null,
  created_at      timestamptz not null default now()
);
```

### 5.5 Ingestion bookkeeping & idempotency

```sql
create table app.crawl_log (
  id              uuid primary key default gen_random_uuid(),
  run_id          uuid not null,
  url             text not null,
  outcome         text not null check (outcome in ('new', 'unchanged', 'updated', 'gone', 'failed')),
  http_status     int,
  error           text,
  document_id     uuid references app.documents(id),
  duration_ms     int,
  created_at      timestamptz not null default now()
);

create table app.crawl_cursor (
  id           text primary key,
  last_url     text,
  updated_at   timestamptz not null default now()
);

create table app.idempotency_keys (
  key             text primary key,
  user_id         uuid not null references app.users(id),
  resource_type   text not null,
  resource_id     uuid not null,
  request_hash    text not null,
  created_at      timestamptz not null default now(),
  expires_at      timestamptz not null
);
```

`crawl_log` retention policy: log every URL touched, including `unchanged`. 24h retention on idempotency keys.

### 5.6 Neo4j schema

Constraints:

```cypher
CREATE CONSTRAINT document_id_unique IF NOT EXISTS
  FOR (d:Document) REQUIRE d.id IS UNIQUE;
CREATE CONSTRAINT document_url_unique IF NOT EXISTS
  FOR (d:Document) REQUIRE d.url IS UNIQUE;
CREATE INDEX document_service_idx IF NOT EXISTS
  FOR (d:Document) ON (d.service);
CREATE INDEX document_title_idx IF NOT EXISTS
  FOR (d:Document) ON (d.title);
```

Single node type:

```
(:Document {
   id, url, title, service, guide, toc_depth, word_count,
   first_seen_at, last_crawled_at, placeholder?
})
```

Edges (phase 1):

- `(:Document)-[:LINKS_TO {discovered_at, section?}]->(:Document)`
- `(:Document)-[:PREV_NEXT {direction}]->(:Document)`
- `(:Document)-[:CO_RETURNED {weight, last_observed_at, observation_count}]->(:Document)`

Postgres `documents.id` ≡ Neo4j `Document.id` (one-to-one).

### 5.7 S3

Deferred for phase 1. We do not provision an S3 bucket. If we need it later (`exports/` for PDF download, `mcp-results/` for audit), we add it then.

### 5.8 Sources of truth

| Concern | Source of truth |
|---|---|
| "Does this URL exist as a document?" | Postgres `app.documents` |
| "URL/title/service/word_count" | Postgres `app.documents` |
| "Are these two docs related, and how?" | Neo4j edges |
| "Who is this user / are they in this org?" | Supabase `auth.users` + `app.org_memberships` |
| "What did this query cost?" | Sum of `app.llm_calls` + `app.mcp_search_log` for that query |
| "What is the actual content of this AWS doc?" | AWS Knowledge MCP — never us |

---

## 6. Data flow

### 6.1 Ingestion pipeline (weekly cron + manual bootstrap)

**Schedule:** EventBridge `cron(0 2 ? * MON *)`. Per-run cap: 2,000 URLs.

**Manual bootstrap:** `POST /internal/ingest/bootstrap` runs uncapped, in chained Lambda invocations, idempotent.

**One run, in pseudocode:**

```
1. Generate run_id (UUID).
2. Fetch https://docs.aws.amazon.com/sitemap_index.xml.
3. Walk per-service sitemaps; collect all URLs.
4. Compute url_hash for each URL.
5. Diff against Postgres app.documents.url_hash:
     - new      → enqueue for full ingest
     - existing → enqueue for "check if changed"
     - in DB but not in sitemap → mark documents.status = 'gone'
6. Apply per-run cap (2000); checkpoint remaining work to crawl_cursor.
7. For each URL up to the cap, ingest_one_page().
```

**`ingest_one_page(url, run_id)`:**

```
1. HTTP GET url; respect 429 with backoff.
2. Parse with BeautifulSoup:
     - title, service (URL heuristic), guide, toc_path
     - links: <a href> in main content, AWS-only, normalized
     - prev/next: TOC nav rel=prev|next
     - word_count
3. hash = sha256(title || sorted_links || toc_path)   — content-independent
4. Postgres upsert (single tx):
     INSERT INTO app.documents ... ON CONFLICT (url) DO UPDATE
       SET title=..., last_crawled_at=now(),
           last_changed_at = CASE WHEN hash != EXCLUDED.hash THEN now() ELSE last_changed_at END
5. Neo4j MERGE node + MERGE link edges (placeholders allowed for unseen targets).
6. Insert app.crawl_log row.
```

**Properties:** idempotent, resumable (via `crawl_cursor`), forward-link-tolerant (placeholder nodes), safe re-fetch (hash discipline).

**`co-returned` edge maintenance** runs after ingestion: read last 24h of `mcp_search_log`, group co-occurring URLs, update edge weights with 30-day decay, drop weight < 0.05.

### 6.2 Query pipeline (sync, user-facing)

```
Browser → API Gateway (JWT validation) → Java api-service:
  1. Idempotency check on (user_id, idempotency_key, request_hash).
  2. Insert app.queries row, status='pending'; status='running'.
  3. POST /internal/agents/run to Python (SigV4 signed).
  4. Wait for response (Java timeout 28s, Python timeout 25s).
  5. Receive { answer, citations[], related_docs[], cost_breakdown, agent_run_id }.
  6. Transactional: insert query_citations, query_related_docs;
     update queries.status='succeeded', answer, total_cost_usd, completed_at.
  7. Return JSON.

Python LangGraph (5 nodes + format):
  plan (Haiku) → mcp_search → graph_traverse → mcp_read (optional) →
  synthesize (Sonnet) → format → return
```

Failure modes (Section 4.7) — graceful degradation, never raw 500s to user.

### 6.3 Auxiliary flows

- **`GET /v1/graph/overview`** — served from a 24h-cached materialized view, capped at top 2,000 nodes by degree centrality
- **`GET /v1/graph/documents/{id}/neighbors`** — Cypher query, capped at 200 nodes per drill-down
- **`GET /v1/queries`** — paginated, RLS-enforced

### 6.4 Async deferred

Phase 1 is sync. Phase 2 introduces `202 Accepted + poll`-style for queries that overrun the gateway window.

---

## 7. Security & auth

### 7.1 Trust boundaries

1. **Browser ↔ Supabase Auth** — JWT issuance, httpOnly cookies, invite-only signup
2. **Browser ↔ Java via API Gateway** — Lambda Authorizer validates JWT against Supabase JWKS
3. **Java ↔ Python** — IAM SigV4, Function URL `AuthType=AWS_IAM`
4. **Python → external** (Anthropic, MCP, Postgres, Neo4j) — credentials in Parameter Store; MCP needs none

### 7.2 Authorization (defense in depth)

- **Application layer:** every Java endpoint checks `caller.userId` against the resource's `user_id`/`org_id`.
- **Database layer:** Postgres RLS using `auth.uid()` matched against `app.org_memberships`. Java sets the JWT context per request via `SET LOCAL "request.jwt.claims" = '...'` (recommended approach).
- **Network layer:** Python Function URL only accepts SigV4-authenticated requests from our roles.

### 7.3 Secrets

| Secret | Storage | Rotation |
|---|---|---|
| Supabase JWT signing key | Supabase manages it | n/a |
| Anthropic API key | Parameter Store SecureString | Manual, quarterly |
| Postgres user passwords (Java + Python users) | Parameter Store SecureString | Manual, semi-annually |
| Neo4j Bolt URI + password | Parameter Store SecureString | Manual, semi-annually |

No secrets in env vars or git. Lambda exec roles scoped to `ssm:GetParameter` on `/aws-docs-graph/<env>/*`.

### 7.4 Database users

- **Supabase Service Role** — never used by application code (too powerful — bypasses RLS).
- **`api_service` user** — used by Java; can read/write `users`, `queries`, `query_citations`, `query_related_docs`, `agent_runs`, `idempotency_keys`. Reads `documents`. RLS applies.
- **`agent_service` user** — used by Python; can write `documents`, `crawl_log`, `mcp_search_log`, `mcp_cache`, `llm_calls`, `agent_runs`, `idempotency_keys`. No access to user-scoped tables.

### 7.5 Input validation & abuse prevention

- Body size cap: 4 KB at API Gateway
- Question length: 1–2000 chars
- Per-user rate limit: 60 queries/hour (gateway + app double)
- Per-user daily LLM cost cap: **$0.50/day** enforced in Java
- Outbound LLM concurrency: 5
- Outbound MCP concurrency: 5

### 7.6 Logging hygiene

Logs may contain UUIDs, status codes, latencies, token counts, error codes. Logs **never** contain question/answer text, JWTs, API keys, DB credentials, or email addresses. Question/answer content lives only in Postgres and is RLS-protected.

### 7.7 Cost guardrails (operational)

| Layer | Mechanism |
|---|---|
| AWS account | Budget $10/mo with email alerts at 50/80/100%; Cost Anomaly Detection $5; Free Tier alerts on |
| Lambda | Reserved concurrency 5/10 |
| API Gateway | Usage plans: 10 req/s, 1000 req/day per principal |
| Java app | Per-user $0.50/day LLM cap |
| Python app | `asyncio.Semaphore(5)` on outbound LLM and MCP |
| Anthropic console | Monthly $20 hard cap |
| CloudWatch | 14d retention on every log group (Terraform-enforced) |

### 7.8 Cloudflare (deferred to phase-1 hardening sprint)

When custom domain is attached:

- Cloudflare Registrar for `yourdomain.com`
- DNS + proxy (orange cloud); free TLS
- Cert: AWS ACM cert at API Gateway, Cloudflare "Full (strict)" SSL
- WAF / rate-limit rules: phase 2 (start with proxy-only)
- Hostnames: `yourdomain.com` (FE on Vercel), `api.yourdomain.com` (API Gateway)

---

## 8. Agent orchestration (LangGraph)

### 8.1 Graph (linear, deterministic, 5 nodes + format)

```
START → plan (Haiku) → mcp_search → graph_traverse → mcp_read (optional) → synthesize (Sonnet) → format → END
```

### 8.2 Node specs

**plan (Haiku 4.5)** — converts question to `{keywords, expected_services, question_type}`. Pydantic-validated JSON output. Fallback on JSON parse failure: deterministic top-noun keyword extractor.

**mcp_search** — parallel `search_documentation` calls per keyword group; merge + dedupe + re-rank; top 8. Side effects: `mcp_search_log`, `mcp_cache`, placeholder doc rows for unseen URLs.

**graph_traverse** — Cypher 1–2 hop expansion via `LINKS_TO | PREV_NEXT | CO_RETURNED`, weighted score, top 10 distinct.

**mcp_read** — top 2 docs only; skipped on `question_type == 'navigation_only'`; truncate each doc to 6,000 chars.

**synthesize (Sonnet 4.6)** — heavily prompt-cached system prompt; produces `{answer, citation_ranks}`; JSON-validated; 1 retry on parse failure; falls back to navigation-style answer if both retries fail.

**format** — pure Python; assembles `{answer, citations[], related_docs[], metadata{}}`.

### 8.3 Per-run guarantees

- Token budget: 50K tokens; trims lowest-ranked sources to fit
- Wall-clock target: <20s; hard cap 25s (Python timeout)
- Per-node duration logged to `agent_runs.step_log` after each step
- Best-effort state persistence after every node so partial trace survives Lambda timeout

### 8.4 Cost per query (median)

| Step | Model | Cost |
|---|---|---|
| plan | Haiku 4.5 | ~$0.0006 |
| mcp_search | — | $0 |
| graph_traverse | — | $0 |
| mcp_read | — | $0 |
| synthesize | Sonnet 4.6 (prompt-cached) | ~$0.005 |
| **Total** | | **~$0.006/query** |

100 queries/day × 30 = ~$18/mo. Fits under $0.50/day per-user × 5 users = $75/mo and under the $20 Anthropic console cap.

### 8.5 Failure modes (degraded responses, never 500)

| Failure | Response | UI banner |
|---|---|---|
| MCP empty / down | graph-only answer | "AWS docs search unavailable — showing related docs from our graph." |
| Neo4j down | citations-only | "Related-doc suggestions temporarily unavailable." |
| Synthesis fails | navigation answer + citations | "Couldn't generate written answer; here are the most relevant pages." |
| Token budget hit | partial answer, `truncated=true` | "Answer truncated to budget." |
| Wall clock | best-effort partial | "Query took longer than expected." |

### 8.6 Tool boundaries (security)

| Tool | Allowed | Not allowed |
|---|---|---|
| `mcp_search` | search via MCP | other MCP tools |
| `mcp_read` | fetch a known AWS URL | arbitrary URLs |
| `cypher_traverse` | read-only | writes |
| `claude` | structured prompts | freeform; tool use |

---

## 9. SDLC plumbing

### 9.1 Repo (mono-repo)

```
aws-docs-graph/
├── .github/workflows/    — ci.yml, deploy-prod.yml, reusable/
├── infra/                — Terraform: modules/, envs/{prod}/  (dev TBD)
├── api-service/          — Java Spring Boot 3 (hexagonal)
├── agent-service/        — Python FastAPI + LangGraph
├── web/                  — Next.js 15 App Router
├── docs/                 — superpowers/specs/, runbooks/, architecture/
├── scripts/              — bootstrap-aws.sh, rotate-secrets.sh, seed-dev.sh
└── README.md
```

### 9.2 Environments (phase 1)

- **local** — Docker Postgres + Docker Neo4j; both backends running locally; FE running locally; Anthropic + MCP via real endpoints (separate dev keys with $5/mo Anthropic cap)
- **prod** — single AWS account, Supabase free project, Neo4j AuraDB Free
- **dev** — TBD; Terraform structure ready, environment may be added later

### 9.3 CI on every push (`.github/workflows/ci.yml`)

Parallel jobs: lint-java, test-java (Postgres+Neo4j Testcontainers), lint-python, test-python (Postgres+Neo4j), lint-web, test-web (Vitest), terraform-validate (fmt, validate, tflint, checkov), dependency-scan (npm audit, pip-audit, Trivy), secret-scan (gitleaks), build-images (on `main`, push to ECR).

### 9.4 Deploy-to-prod (`deploy-prod.yml`)

1. Re-run all CI checks
2. Pull image SHAs from ECR
3. `terraform plan -out=tfplan`
4. Display plan summary
5. **Manual approval gate** (GitHub Environments protection)
6. `terraform apply`
7. Flyway migrate (Postgres prod)
8. Neo4j-migrations migrate (Neo4j prod)
9. Smoke test: `GET /v1/healthz` expect 200
10. Smoke test: canary query, expect non-empty answer ≥1 citation, cost <$0.01
11. Notify on failure

Rollback = re-run deploy-prod with previous SHA.

### 9.5 Infrastructure as Code (Terraform)

State backend: S3 bucket + DynamoDB lock table (pre-created by bootstrap script).
Module discipline: pure modules under `infra/modules/`, env composition under `infra/envs/<env>/`.
Tagging: every resource tagged `project=aws-docs-graph`, `env=<env>`, `cost-center=learning`.

### 9.6 Observability

**Logs:** JSON-structured, 14d retention. No PII, no question/answer content.

**Metrics (CloudWatch EMF):**
- `query_count` (status), `query_duration_ms` (question_type), `agent_node_duration_ms` (node), `llm_cost_usd` (model, source), `mcp_call_count` (tool, status), `mcp_call_latency_ms` (tool), `ingest_pages_processed` (outcome), `daily_cost_per_user_usd` (user_id)

**Traces:** AWS X-Ray gateway → Java → Python → external; trace ID propagated via SigV4 headers.

**Alarms (SNS email):** daily LLM cost > $1; query failure rate > 10% over 15min; MCP error rate > 25%; Lambda p99 > 25s; reserved concurrency > 80%; Budget 80%; Anomaly Detection trigger.

**Dashboards:** Operations dashboard (rates, latencies, agent step durations, MCP health) + Cost dashboard (daily LLM spend, MCP volume, Lambda cost).

### 9.7 Local dev experience

`make dev` brings up: Docker Postgres + Neo4j (with persistent volumes), runs Flyway and Neo4j migrations, starts Java service (talks to local DBs, WireMock for Python service), starts Python service (talks to local DBs, real Anthropic + MCP), starts Next.js. New laptop → 30 minutes to first running query.

---

## 10. Testing strategy

Pyramid: heavy unit, real-DB integration, e2e deferred.

### 10.1 Java api-service

- **Unit tests** — pure JUnit 5 + AssertJ + Mockito; cover domain + application
- **Integration tests** — Spring Boot test slice + Testcontainers; one Postgres container per test class, reused; Flyway migrates against container; WireMock for Python and Supabase JWKS; cover REST endpoints, RLS enforcement, idempotency replay, SigV4 outbound signing
- **Architecture tests** — ArchUnit rules enforcing hexagonal boundaries
- Coverage target: 75% on `domain` + `application`, 50% overall

### 10.2 Python agent-service

- **Unit tests** — pytest + pytest-asyncio; cover each LangGraph node, prompt construction, output validation, retry logic, token budget; mock Anthropic via fixtures, MCP via `respx`
- **Integration tests** — Testcontainers Postgres + Neo4j; real LangGraph; mock Anthropic + MCP; cover happy path, idempotent ingestion, dual-write resilience, degraded mode
- **Property-based tests** — Hypothesis: ingestion idempotency invariant
- Coverage target: 70% on `agents/` and `adapters/`, 50% overall

### 10.3 Frontend

- **Unit** — Vitest + RTL
- **Integration** — Vitest with happy-dom + MSW
- Coverage target: ~50%

### 10.4 Cross-cutting

- **Contract tests** — JSON schemas for `/internal/...` endpoints, validated in CI
- **Smoke tests** — in deploy-prod workflow
- **Cost regression script** — `tests/fixtures/questions.yaml` (20 questions); manual run after agent prompt changes; alert if total cost drift > 25%
- **Performance / load** — manual `vegeta` runs; not in CI in phase 1

### 10.5 Test fixtures

- Postgres SQL fixtures and seed scripts
- Neo4j Cypher test fixtures (~5 docs / ~6 edges minimal subgraph)
- MCP captured-response fixtures (sanitized JSON)
- Question fixtures (20 typical questions across all `question_type` values)

### 10.6 Pre-commit gates

ruff (Python), spotless (Java), prettier (web), markdownlint, gitleaks, trivy fs.

---

## 11. Phase-2+ deferred items (architectural notes)

Each is designed-for, not built:

- **Personal browsing graph** — `app.user_visits` table referencing `app.documents.id`; per-user view layer in FE; `(:User)-[:VISITED]->(:Document)` edges in Neo4j (separate database or labeled nodes)
- **Open multi-tenancy** — flip Supabase Auth open signup; add `POST /v1/orgs` and invitation flows; no schema changes
- **Streaming responses** — Lambda response streaming + Java SSE
- **Async query path** — `202 Accepted` + Supabase Realtime subscriptions on `app.queries` updates
- **Conversational follow-ups** — `thread_id` is already nullable on `queries`; phase 2 adds threading
- **Concept extraction** — LLMGraphTransformer over crawled HTML; new edge type `MENTIONS_CONCEPT`; new node type `:Concept`
- **E2E tests** — Playwright in CI deploy-prod gate
- **Per-query subgraph view** — capture which subgraph the agent traversed; render as standalone view
- **Edge protections (Cloudflare)** — WAF rules, rate-limit rules, edge caching for `/v1/graph/overview`, Origin Certificate
- **Async background reconciler** — Postgres ↔ Neo4j drift detection
- **Auto-rollback / canary deploy** — current rollback is manual re-deploy of prior SHA
- **MFA / SSO / SCIM** — Supabase supports it; add when multi-tenant

---

## 12. Open items (intentionally TBD)

- Whether to provision a `dev` AWS environment in addition to local + prod
- Exact Cloudflare zone configuration (deferred to phase-1 hardening sprint)
- Specific Anthropic models if pricing or capabilities change before implementation
- Whether to capture MCP results in an audit S3 bucket — depends on debugging needs once running

---

## 13. Risks and mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| AWS Knowledge MCP rate limits unspecified | Query path degraded under load | Backoff + retry, circuit breaker, 24h cache, graph-only degraded mode |
| AWS Knowledge MCP availability | Same | Same — degraded mode is honest and useful |
| Neo4j AuraDB Free 200K-node limit | Could overflow | AWS docs corpus is ~5K–10K pages; well under |
| Lambda cold starts (Spring Boot) | First request slow | SnapStart enabled; targeted warm-up via scheduled invocations if needed |
| Dual-write Postgres ↔ Neo4j drift | Inconsistent graph | Idempotent retries on next run; phase-2 reconciler |
| LLM cost runaway | Monthly bill spike | Layered caps: per-user, per-run, Anthropic console hard cap, AWS Budget |
| Supabase free tier limits | Database stops accepting writes | Hard-capped by Supabase; visible in dashboard; upgrade path is one click |
| Lost productivity from over-engineering | Project never ships | Explicit "deferred to phase 2" lists in every section |

---

## 14. Validation criteria for "phase 1 done"

The project is phase-1-complete when **all** of the following are true:

1. A user can sign up via email + password (invite-only) and log in
2. A user can submit a question via `/ask` and receive an answer with citations + related docs in <30s
3. The graph atlas view at `/graph` renders force-directed with at least 200 documents and color-coding by service
4. Drill-down from a node renders 1-hop neighbors
5. Daily ingestion (or manual bootstrap) populates ≥500 documents into Postgres + Neo4j
6. CI is green on `main`; manual deploy-prod runs end-to-end including Flyway + Neo4j migrations + smoke tests
7. CloudWatch dashboards show query rate, latency, daily LLM cost
8. AWS Budget at $10/mo with alarms is verified active
9. RLS prevents user A from reading user B's queries (verified by integration test)
10. ArchUnit rules pass; hexagonal boundaries clean
11. README + at least 3 runbooks (deploy, rollback, rotate-secrets) exist and are accurate
12. Cloudflare + custom domain attached (final hardening task)

---

## Appendix A — Question response shape (canonical)

```json
{
  "id": "q_01HX...",
  "question": "How do I tag ECS resources for cost allocation?",
  "answer": "To tag ECS resources for cost allocation, you... [1] Then activate the tags in the Billing console [2]...",
  "citations": [
    {
      "rank": 1,
      "title": "Tagging Amazon ECS resources",
      "url": "https://docs.aws.amazon.com/AmazonECS/latest/developerguide/ecs-using-tags.html",
      "service": "ECS",
      "snippet": "...",
      "score": 0.91,
      "source_kind": "mcp_search"
    },
    {
      "rank": 2,
      "title": "Activating user-defined cost allocation tags",
      "url": "https://docs.aws.amazon.com/awsaccountbilling/latest/aboutv2/activating-tags.html",
      "service": "Billing",
      "snippet": "...",
      "score": 0.87,
      "source_kind": "mcp_search"
    }
  ],
  "related_docs": [
    {
      "title": "AWS Cost Explorer",
      "url": "https://docs.aws.amazon.com/awsaccountbilling/latest/aboutv2/ce-what-is.html",
      "service": "Billing",
      "hop_count": 1,
      "edge_path": ["LINKS_TO"]
    }
  ],
  "metadata": {
    "duration_ms": 8420,
    "cost_usd": 0.006,
    "degraded": false,
    "truncated": false
  },
  "created_at": "2026-06-04T12:34:56Z"
}
```

## Appendix B — Sources referenced

- AWS Knowledge MCP server: `https://github.com/awslabs/mcp/tree/main/src/aws-knowledge-mcp-server` (verified endpoint: `https://knowledge-mcp.global.api.aws`, transport: Streamable HTTP, no auth)
- AWS docs sitemap index: `https://docs.aws.amazon.com/sitemap_index.xml`
- Supabase RLS + JWT claim setting documented at `supabase.com/docs/guides/auth/row-level-security`
- Neo4j AuraDB Free tier limits: 200K nodes / 400K edges, 50MB RAM, 1 instance per email
- Reference graph visualization style: standard force-directed layout (e.g., `react-force-graph-2d`, Neo4j Browser default)
