# AWS Docs Graph — Phase 1 Implementation Calendar

**Status:** Approved
**Date:** 2026-06-12
**Pace:** Sprint — ~15–20 hrs/week (~35 hrs total)
**Timeline:** 2026-06-16 → 2026-06-29 (2 weeks)
**Depends on:** `2026-06-04-aws-docs-graph-design.md`

---

## Overview

Two weeks. Two clear halves.

**Week 1** builds everything you can't see — infrastructure, data, ingestion, the agent brain.
**Week 2** builds everything you can — the API surface, the UI, the graph, observability, and the final hardening that makes it production-grade.

Each day has a focus. Each week ends with a gate that must pass before moving on.

---

## Week 1 — The Foundation
### *"Data in, pipeline running, nothing broken"*
**2026-06-16 to 2026-06-22**

```
Mon  ░░░░░░░░  Accounts + Repo
Tue  ████████  Local dev environment
Wed  ████████  Terraform + AWS wiring
Thu  ████████  Python ingestion pipeline
Fri  ████████  Ingest to prod + CI green
Sat  ░░░░░░░░  Buffer / overflow
Sun  ─────────
```

---

### Day 1 — Monday 16 Jun · Accounts + Repo

**External accounts (do these first — some have email confirmation delays):**

| Service | Action |
|---|---|
| AWS | Enable billing alerts · Create IAM user (least-privilege) · Enable MFA |
| Supabase | Create free project · Note connection strings · Enable invite-only auth |
| Neo4j AuraDB Free | Create instance · Download credentials bolt URI + password |
| Anthropic | Create API key · Set $5/mo dev console hard cap |
| Vercel | Create project · Link to GitHub repo (empty for now) |

**Repo scaffold:**
```
aws-docs-graph/
├── .github/workflows/     ci.yml  deploy-prod.yml
├── infra/                 modules/  envs/prod/
├── api-service/           (Java — scaffold only)
├── agent-service/         (Python — scaffold only)
├── web/                   (Next.js — scaffold only)
├── docs/superpowers/      specs/  plans/
├── scripts/               bootstrap-aws.sh  seed-dev.sh
├── Makefile
└── .env.example
```

Pre-commit hooks: `ruff` · `spotless` · `prettier` · `gitleaks` · `trivy fs`

---

### Day 2 — Tuesday 17 Jun · Local Dev Environment

**Docker Compose** — Postgres 16 + Neo4j 5, persistent named volumes, health checks.

**Flyway migrations V1–V6** (all Phase 1 tables from design doc §5):
- `V1` — `app.users` · `app.organizations` · `app.org_memberships`
- `V2` — `app.documents` + indexes
- `V3` — `app.queries` · `app.query_citations` · `app.query_related_docs` + RLS
- `V4` — `app.agent_runs` · `app.llm_calls` · `app.mcp_search_log` · `app.mcp_cache`
- `V5` — `app.crawl_log` · `app.crawl_cursor` · `app.idempotency_keys`
- `V6` — Trigger: auto-create personal org on user insert

**Neo4j** — constraints + indexes (design doc §5.6).

**`make dev`** — boots both DBs, runs migrations, verifies health, prints connection strings.

> ✅ Gate check: `make dev` → both DBs green, all migrations applied.

---

### Day 3 — Wednesday 18 Jun · Terraform + AWS Wiring

**Bootstrap script** (`scripts/bootstrap-aws.sh`):
- S3 state bucket + DynamoDB lock table
- Parameter Store SecureStrings placeholders for all secrets

**Terraform `infra/`:**

| Resource | Config |
|---|---|
| ECR | Two repos: `api-service` · `agent-service` |
| Lambda (Java) | SnapStart · 512 MB · 30s timeout · CloudWatch log group 14d |
| Lambda (Python) | Container · 2048 MB · 5 min timeout · reserved concurrency 5 · Function URL `AuthType=AWS_IAM` |
| Lambda Authorizer | Validates Supabase JWT against JWKS · 300s cache |
| API Gateway REST | Usage plan 10 req/s · 1000 req/day · CORS allow-list |
| EventBridge | `cron(0 2 ? * MON *)` → ingest-cron Lambda |
| IAM | Lambda exec roles · SigV4 invoke role (Java → Python) |
| AWS Budgets | $10/mo · alerts at 50% / 80% / 100% |
| Cost Anomaly Detection | $5 threshold |
| SNS topic | Email subscription for all alarms |

`terraform validate` + `tflint` pass.

---

### Day 4 — Thursday 19 Jun · Python Ingestion Pipeline

**FastAPI project** (`agent-service/`):

```
agent-service/
├── app/
│   ├── main.py              FastAPI app + routes
│   ├── ingest/
│   │   ├── sitemap.py       sitemap walk · diff · 2000-URL cap · crawl_cursor
│   │   ├── page.py          single-URL idempotent ingest (parse → Postgres → Neo4j)
│   │   └── bootstrap.py     uncapped chained invocation
│   ├── graph/
│   │   └── co_returned.py   CO_RETURNED edge maintenance
│   ├── db/
│   │   ├── postgres.py      asyncpg connection pool
│   │   └── neo4j.py         neo4j-driver session factory
│   └── config.py            settings from Parameter Store
├── tests/
│   ├── unit/                parse logic · hash logic · Cypher generation
│   └── integration/         Testcontainers Postgres + Neo4j
├── Dockerfile
└── requirements.txt
```

**Endpoints:**

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/internal/healthz` | Liveness |
| `POST` | `/internal/ingest/page` | Single-URL idempotent ingest |
| `POST` | `/internal/ingest/sitemap` | Sitemap walk · diff · capped |
| `POST` | `/internal/ingest/bootstrap` | Uncapped initial fill |
| `POST` | `/internal/graph/co-returned` | CO_RETURNED edge maintenance |

**Ingest logic for one page:**
1. HTTP GET url, respect 429 with backoff
2. BeautifulSoup: title · service · guide · toc_path · links · prev/next · word_count
3. `hash = sha256(title + sorted_links + toc_path)`
4. Postgres `ON CONFLICT` upsert — update `last_changed_at` only if hash changed
5. Neo4j `MERGE` node + `MERGE` LINKS_TO / PREV_NEXT edges (placeholder nodes allowed)
6. Insert `crawl_log` row

Tests: unit (parse logic, hash, Cypher), integration (Testcontainers, idempotency invariant via Hypothesis).

---

### Day 5 — Friday 20 Jun · Ingest to Prod + CI Green

**Deploy Python to prod:**
- Build container image → push to ECR
- `terraform apply` — Python Lambda + EventBridge + IAM
- Manually invoke `POST /internal/ingest/bootstrap` via AWS console
- Verify: ≥500 rows in `app.documents` · ≥500 `:Document` nodes in Neo4j AuraDB

**GitHub Actions `ci.yml`** (parallel jobs):
- `lint-python` — ruff
- `test-python` — pytest + Testcontainers (Postgres + Neo4j)
- `lint-java` — spotless (placeholder, no Java code yet)
- `terraform-validate` — fmt + validate + tflint + checkov
- `secret-scan` — gitleaks
- `dependency-scan` — pip-audit + Trivy

> ✅ **Week 1 Gate:** CI green on `main` · ≥500 docs in prod Postgres + Neo4j · `make dev` works · AWS Budget alarm confirmed active.

---

## Week 2 — The Product
### *"Ship it: API, agent, UI, graph, prod-hardened"*
**2026-06-23 to 2026-06-29**

```
Mon  ████████  Java api-service + LangGraph agent
Tue  ████████  Query pipeline end-to-end
Wed  ████████  Next.js frontend
Thu  ████████  Graph atlas + observability
Fri  ████████  Hardening: Cloudflare · deploy-prod · runbooks
Sat  ░░░░░░░░  Buffer / final validation checklist
Sun  ─────────
```

---

### Day 6 — Monday 23 Jun · Java api-service + LangGraph Agent

**Java api-service** (`api-service/`):

```
api-service/src/main/java/com/awsdocs/
├── domain/              Query · Document · User · value objects (no framework imports)
├── application/         QueryService · GraphService · ports (interfaces)
├── adapter/in/rest/     @RestController · DTOs · request validation
├── adapter/out/persistence/   Postgres repos · Flyway migrations
├── adapter/out/agent/   SigV4HttpClient → Python
├── adapter/out/graph/   Neo4jReadClient (Cypher read-only)
└── infrastructure/      Spring config · Lambda handler shim
```

Endpoints scaffolded (implementations follow Day 7):
`GET /v1/healthz` · `GET /v1/me` · `POST /v1/queries` · `GET /v1/queries/{id}` · `GET /v1/queries` · `GET /v1/graph/overview` · `GET /v1/graph/documents/{id}` · `GET /v1/graph/documents/{id}/neighbors` · `GET /v1/graph/search`

**Lambda Authorizer** — validate Supabase JWT against JWKS endpoint, inject `userId` + `email`, 300s cache.

**LangGraph agent** (`agent-service/app/agents/`):

```
agents/
├── graph.py             LangGraph StateGraph definition
├── state.py             AgentState TypedDict
├── nodes/
│   ├── plan.py          Haiku 4.5 → {keywords, expected_services, question_type}
│   ├── mcp_search.py    parallel search_documentation · merge · top 8
│   ├── graph_traverse.py  Cypher 1-2 hop · top 10
│   ├── mcp_read.py      top 2 docs · 6000 char truncate
│   ├── synthesize.py    Sonnet 4.6 · cached system prompt · {answer, citation_ranks}
│   └── format.py        assemble canonical response shape
└── prompts/
    ├── plan.txt
    └── synthesize.txt   (heavily cached — static system prompt)
```

Degraded modes: MCP down → graph-only · Neo4j down → citations-only · synthesis fail → navigation answer · token budget → partial with `truncated=true` · wall-clock → best-effort partial.

Token budget: 50K/run. Wall-clock target: <20s, hard cap 25s.

Unit tests: each node individually mocked (Anthropic via fixtures, MCP via `respx`).

---

### Day 7 — Tuesday 24 Jun · Query Pipeline End-to-End

**Java — `POST /v1/queries`** (full implementation):
1. Idempotency check on `(user_id, idempotency_key, request_hash)`
2. Insert `app.queries` `pending` → `running`
3. Check per-user $0.50/day LLM cost cap (`sum(llm_calls.cost_usd)` for user today)
4. SigV4-signed `POST /internal/agents/run` to Python (28s Java timeout)
5. Transactional write: `query_citations` + `query_related_docs`; update `queries.status='succeeded'`
6. Return canonical JSON response

**Python — `POST /internal/agents/run`** (wire LangGraph):
- Accepts `{query_id, user_id, org_id, question}`
- Runs LangGraph state machine
- Writes `agent_runs` + `llm_calls` + `mcp_search_log`
- Returns `{answer, citations[], related_docs[], cost_breakdown, agent_run_id}`

**Java — `GET /v1/queries/{id}`** + **`GET /v1/queries`** (paginated, RLS enforced).

**Integration tests:**
- Java: Testcontainers Postgres · WireMock Python stub · idempotency replay · RLS enforcement (user A ≠ user B) · cost cap enforcement
- Python: Testcontainers Postgres + Neo4j · real LangGraph · mock Anthropic + MCP · happy path · degraded modes

**CI additions:** `test-java` job with Testcontainers.

> ✅ Mid-week check: `POST /v1/queries` with a real AWS question returns answer + ≥1 citation in <30s in prod.

---

### Day 8 — Wednesday 25 Jun · Next.js Frontend

**Next.js 15 App Router** (`web/`):

```
web/
├── app/
│   ├── layout.tsx            root layout · Supabase Auth provider
│   ├── page.tsx              / → redirect to /ask if authed, else /login
│   ├── login/page.tsx        Supabase Auth UI · email+password · invite-only
│   ├── ask/page.tsx          question input · answer · citations · related-docs
│   ├── history/page.tsx      paginated query list
│   ├── queries/[id]/page.tsx full query detail
│   ├── graph/page.tsx        force-directed atlas · react-force-graph-2d
│   ├── graph/[id]/page.tsx   neighborhood view · node detail panel
│   └── account/page.tsx      display name · daily cost used
├── components/
│   ├── QueryForm.tsx          question input + submit
│   ├── AnswerPanel.tsx        answer with inline [n] citation markers
│   ├── CitationsPanel.tsx     ranked citation list with snippets
│   ├── RelatedDocsPanel.tsx   related docs with hop-count + edge-path
│   ├── DegradedBanner.tsx     3 variants (MCP down · Neo4j down · synthesis fail)
│   ├── GraphCanvas.tsx        react-force-graph-2d wrapper · color-by-service
│   └── NodeDetailPanel.tsx    title · URL · service · word_count
├── lib/
│   ├── api.ts                 TanStack Query client · base URL · auth header
│   └── supabase.ts            Supabase client (auth only, never data)
└── middleware.ts              protected route guard
```

**Supabase Auth:** httpOnly cookie session · invite-only signup · protected route middleware.

**Graph viewer:** `react-force-graph-2d` · color palette keyed by `service` string · click node → `/graph/[id]` · top 2000 nodes from `GET /v1/graph/overview`.

**Degraded banners** (from design doc §8.5):
- *"AWS docs search unavailable — showing related docs from our graph."*
- *"Related-doc suggestions temporarily unavailable."*
- *"Couldn't generate written answer; here are the most relevant pages."*

Tests: Vitest + RTL unit · Vitest + MSW integration (happy path + error states + banners).
CI addition: `lint-web` · `test-web` jobs.

---

### Day 9 — Thursday 26 Jun · Graph Atlas + Observability

**Java — graph endpoints:**

| Endpoint | Detail |
|---|---|
| `GET /v1/graph/overview` | Top 2000 nodes by degree centrality · 24h materialized view cache · `{nodes[], edges[]}` |
| `GET /v1/graph/documents/{id}` | Single document detail |
| `GET /v1/graph/documents/{id}/neighbors?hops=1` | Cypher 1-hop · cap 200 nodes |
| `GET /v1/graph/search?q=` | Title/URL substring search |

**CloudWatch EMF metrics** (both Lambdas emit structured JSON):

| Metric | Dimensions |
|---|---|
| `query_count` | status |
| `query_duration_ms` | question_type |
| `agent_node_duration_ms` | node |
| `llm_cost_usd` | model · source |
| `mcp_call_count` | tool · status |
| `mcp_call_latency_ms` | tool |
| `ingest_pages_processed` | outcome |
| `daily_cost_per_user_usd` | user_id |

**AWS X-Ray** — gateway → Java → Python traces, trace ID propagated via SigV4 headers.

**CloudWatch dashboards:**
- **Operations** — query rate · p50/p99 latency · agent node durations · MCP health
- **Cost** — daily LLM spend by model · MCP call volume · Lambda cost

**SNS alarms:**
- Daily LLM cost > $1
- Query failure rate > 10% over 15 min
- MCP error rate > 25%
- Lambda p99 > 25s
- Reserved concurrency > 80%
- Budget 80%
- Anomaly Detection trigger

---

### Day 10 — Friday 27 Jun · Hardening: Cloudflare · deploy-prod · Runbooks

**Cloudflare + custom domain:**
- DNS: `yourdomain.com` → Vercel · `api.yourdomain.com` → API Gateway
- AWS ACM cert for `api.yourdomain.com`
- Cloudflare "Full (strict)" SSL mode
- Verify TLS end-to-end for both hostnames

**`deploy-prod.yml`** full pipeline:
1. Re-run all CI checks
2. `terraform plan -out=tfplan` · display plan summary
3. **Manual approval gate** (GitHub Environments protection)
4. `terraform apply`
5. Flyway migrate (Postgres prod)
6. Neo4j migrations (constraints + indexes)
7. Smoke test: `GET /v1/healthz` → 200
8. Smoke test: canary query → non-empty answer · ≥1 citation · cost <$0.01
9. Notify on failure

**Runbooks** (each verified by actually doing the procedure):
- `docs/runbooks/deploy.md` — step-by-step prod deploy
- `docs/runbooks/rollback.md` — re-deploy prior SHA, verify smoke tests pass
- `docs/runbooks/rotate-secrets.md` — rotate Anthropic key · Postgres passwords · Neo4j password

**README** — updated with real getting-started instructions. New laptop → first query in ~30 min.

---

### Saturday 28 Jun · Final Validation Checklist

All 12 criteria from design doc §14 — check each one:

- [ ] 1. Invite-only signup + email login works
- [ ] 2. `/ask` returns answer + citations + related docs in <30s
- [ ] 3. `/graph` renders ≥200 nodes with color-by-service
- [ ] 4. Node drill-down shows 1-hop neighbors
- [ ] 5. ≥500 documents in Postgres + Neo4j (from Week 1)
- [ ] 6. CI green on `main` · deploy-prod runs end-to-end
- [ ] 7. CloudWatch dashboards show query rate · latency · daily LLM cost
- [ ] 8. AWS Budget $10/mo alarms verified active
- [ ] 9. RLS test: user A cannot read user B's queries (integration test passes)
- [ ] 10. ArchUnit rules pass · hexagonal boundaries clean
- [ ] 11. README + 3 runbooks exist and are accurate
- [ ] 12. Cloudflare + custom domain attached

> ✅ **Week 2 Gate / Phase 1 Complete:** All 12 criteria checked off.

---

## Summary

| Day | Date | Focus | Done when… |
|---|---|---|---|
| 1 | Mon Jun 16 | Accounts + repo scaffold | All accounts created · repo bootstrapped |
| 2 | Tue Jun 17 | Local dev + migrations | `make dev` → both DBs green |
| 3 | Wed Jun 18 | Terraform + AWS wiring | `terraform validate` passes · resources defined |
| 4 | Thu Jun 19 | Python ingestion pipeline | Unit + integration tests green |
| 5 | Fri Jun 20 | Ingest to prod + CI | ≥500 docs in prod · CI green on `main` |
| — | — | — | **WEEK 1 GATE** |
| 6 | Mon Jun 23 | Java skeleton + LangGraph agent | Both projects scaffold · agent unit tests green |
| 7 | Tue Jun 24 | Query pipeline end-to-end | Real answer with citations in <30s in prod |
| 8 | Wed Jun 25 | Next.js frontend | Browser end-to-end working |
| 9 | Thu Jun 26 | Graph atlas + observability | Graph renders · dashboards live · alarms wired |
| 10 | Fri Jun 27 | Hardening + runbooks | deploy-prod pipeline verified · runbooks written |
| 11 | Sat Jun 28 | Final validation | All 12 criteria ✅ — **Phase 1 complete** |

---

## What's been cut to fit 2 weeks

Deferred beyond Phase 1 (in addition to everything already in design doc §11):

| Cut item | Why | When |
|---|---|---|
| Cost regression script (20-question fixture) | Nice-to-have, not blocking | Add post-launch |
| ArchUnit strict rules | Basic package guard in CI is sufficient for now | Strengthen in Phase 2 |
| WireMock offline Java dev | Adds complexity; real Python runs locally | Add if offline dev becomes a pain point |
| `navigation_only` mcp_read skip | Minor optimisation | Phase 2 agent refinement |
