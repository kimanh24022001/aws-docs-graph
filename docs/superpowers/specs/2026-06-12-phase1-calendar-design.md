# AWS Docs Graph — Phase 1 Implementation Calendar

**Status:** Design approved, ready for implementation planning
**Date:** 2026-06-12
**Author:** Brainstorm session (user + Claude)
**Depends on:** `2026-06-04-aws-docs-graph-design.md`

---

## 1. Scope

This document breaks the Phase 1 implementation into a 7-week calendar at a sprint pace (~15–20 hrs/week). Each week has a single primary focus, a set of concrete tasks, and a binary gate that must pass before week N+1 begins. The calendar targets all 12 validation criteria from the design doc section 14.

Start date: **week of 2026-06-16**.
End date: **week of 2026-07-28** (gate closes ~2026-08-03).

---

## 2. Decisions

| Topic | Choice | Rationale |
|---|---|---|
| Pace | ~15–20 hrs/week (sprint) | User-stated preference |
| Structure | Track-based, one primary track per week | Minimises context-switching; each week produces a deployable increment |
| Dependency order | Foundation → Java → Ingestion → Agent → Frontend → Graph/Obs → Hardening | Each layer depends on the one below; no week starts until its gate passes |
| Parallelism within a week | Allowed where no dependency exists | e.g. Terraform + app code in same week |
| Setup tasks | Week 1 (accounts, tooling, local dev) | Must precede all code |

---

## 3. Weekly calendar

### Week 1 — Foundation (2026-06-16 to 2026-06-22)
**Focus:** Zero-to-running-locally in <30 min on any machine.

**External account setup:**
- AWS account: enable billing alerts, create IAM user with least-privilege, enable MFA
- Supabase: create free project, note connection strings, enable email invite-only auth
- Neo4j AuraDB Free: create instance, download credentials
- Anthropic: create API key, set $5 dev console cap
- Vercel: create project (empty, linked to repo)

**Repo + tooling:**
- Mono-repo scaffold: all top-level dirs per design doc section 9.1
- `.github/workflows/` stubs (ci.yml, deploy-prod.yml skeletons)
- `Makefile` with `dev`, `test`, `lint`, `migrate` targets
- Pre-commit config: ruff, spotless, prettier, gitleaks, trivy fs
- `.env.example` for all required env vars (no secrets in git)

**Infrastructure foundation:**
- Terraform: S3 state bucket + DynamoDB lock table (bootstrap script `scripts/bootstrap-aws.sh`)
- Terraform: `infra/modules/` and `infra/envs/prod/` structure with provider config, tagging defaults
- `terraform validate` + `tflint` pass in CI

**Local dev:**
- `docker-compose.yml`: Postgres 16 + Neo4j 5 with persistent named volumes
- Flyway migrations V1–V6: all Phase 1 tables, indexes, RLS policies (from design doc section 5)
- Neo4j constraints + indexes (from design doc section 5.6)
- `make dev` boots both DBs, runs migrations, verifies health

**Gate:** `git clone` → `make dev` → both DBs healthy, all migrations applied, pre-commit hooks pass. No AWS deployment yet.

---

### Week 2 — Java api-service skeleton + CI (2026-06-23 to 2026-06-29)
**Focus:** Hexagonal skeleton, Lambda packaging, CI green, first prod deploy.

**Java api-service:**
- Spring Boot 3 project with hexagonal package structure (`domain/`, `application/`, `adapter/in/rest/`, `adapter/out/persistence/`, `adapter/out/agent/`, `adapter/out/graph/`, `infrastructure/`)
- Lambda handler shim (aws-serverless-java-container or Spring Cloud Function)
- SnapStart configuration
- `GET /v1/healthz` — liveness endpoint
- `GET /v1/me` — caller profile from JWT claims
- Supabase JWKS validation in Lambda Authorizer (separate small Lambda)
- ArchUnit rules: domain/application/adapter boundaries enforced
- WireMock setup for Python service (used in integration tests)
- Testcontainers: Postgres container for integration tests, Flyway migrates against it

**CI pipeline (`ci.yml`):**
- Parallel jobs: lint-java, test-java, lint-web (placeholder), terraform-validate, secret-scan (gitleaks), dependency-scan (pip-audit, npm audit, Trivy)
- Build Docker image on `main`, push to ECR

**Terraform (prod):**
- ECR repository (Java image)
- Lambda function (Java, SnapStart enabled)
- API Gateway REST with Lambda Authorizer
- IAM roles: Lambda exec role, Authorizer exec role
- Parameter Store: placeholder SecureStrings for all secrets (values set manually)
- CloudWatch log groups (14d retention)

**Gate:** CI green on `main`; `POST /deploy` via manual `terraform apply`; `GET /v1/healthz` returns 200 in prod; `GET /v1/me` returns caller's userId from JWT.

---

### Week 3 — Python agent-service + ingestion pipeline (2026-06-30 to 2026-07-06)
**Focus:** Real documents flowing into Postgres + Neo4j.

**Python agent-service:**
- FastAPI project structure (`agents/`, `adapters/`, `ingest/`, `graph/`)
- Lambda container packaging (Dockerfile, ECR push)
- `GET /internal/healthz`
- `POST /internal/ingest/page` — single URL idempotent ingest (BeautifulSoup parse → Postgres upsert → Neo4j MERGE node + LINKS_TO/PREV_NEXT edges)
- `POST /internal/ingest/sitemap` — sitemap walk, URL diff, 2000-URL/run cap, `crawl_cursor` checkpoint
- `POST /internal/ingest/bootstrap` — uncapped chained Lambda invocations
- `POST /internal/graph/co-returned` — read 24h mcp_search_log, compute co-occurrence, update CO_RETURNED edges with 30-day decay

**Testing:**
- pytest unit tests: ingest page parsing, hash logic, Cypher MERGE generation
- pytest integration tests: Testcontainers Postgres + Neo4j; happy path + idempotent re-run + gone-URL detection
- Hypothesis property test: ingest idempotency invariant

**CI additions:**
- lint-python, test-python jobs

**Terraform (prod):**
- ECR repository (Python image)
- Python Lambda (container, 2048MB, 5min timeout, reserved concurrency 5)
- Function URL with `AuthType=AWS_IAM`
- EventBridge rule: `cron(0 2 ? * MON *)` → ingest-cron Lambda → Python `/internal/ingest/sitemap`
- ingest-cron Lambda (tiny invoker, IAM role to call Python Function URL)

**Manual run:**
- After deploy: `POST /internal/ingest/bootstrap` via AWS console or `scripts/seed-dev.sh`
- Verify ≥500 documents in Postgres + ≥500 nodes in Neo4j

**Gate:** ≥500 AWS doc URLs in prod Postgres `app.documents` + ≥500 `:Document` nodes in Neo4j AuraDB.

---

### Week 4 — LangGraph agent + query pipeline (2026-07-07 to 2026-07-13)
**Focus:** End-to-end question → answer with citations.

**Python: LangGraph agent:**
- LangGraph linear state machine: `plan → mcp_search → graph_traverse → mcp_read → synthesize → format`
- **plan node** (Haiku 4.5): question → `{keywords, expected_services, question_type}`; Pydantic validation; deterministic fallback
- **mcp_search node**: parallel `search_documentation` per keyword group; merge + dedupe + re-rank; top 8; writes `mcp_search_log`, `mcp_cache`
- **graph_traverse node**: Cypher 1–2 hop via `LINKS_TO | PREV_NEXT | CO_RETURNED`; top 10 distinct
- **mcp_read node**: top 2 docs, skip on `navigation_only`, truncate to 6000 chars
- **synthesize node** (Sonnet 4.6): heavily cached system prompt; `{answer, citation_ranks}`; 1 retry; navigation fallback
- **format node**: assembles canonical response shape (Appendix A of design doc)
- Per-run token budget: 50K; wall-clock target <20s, hard cap 25s
- All 5 degraded mode responses (MCP down, Neo4j down, synthesis fail, token budget, wall clock)
- MCP retry: exponential backoff + jitter, max 2 attempts; circuit breaker (5 failures → open 60s)
- `POST /internal/agents/run` endpoint
- Unit tests: each node mocked (Anthropic via fixtures, MCP via respx)

**Java: query endpoints:**
- `POST /v1/queries` — idempotency check, insert `app.queries` pending→running, SigV4 POST to Python, write `query_citations` + `query_related_docs` transactionally, return response
- `GET /v1/queries/{id}` — fetch single query (RLS enforced)
- `GET /v1/queries` — paginated history (RLS enforced)
- Per-user $0.50/day LLM cost cap: check `sum(llm_calls.cost_usd)` for user today before dispatching
- Integration tests: Testcontainers + WireMock Python stub; idempotency replay; RLS enforcement; cost cap enforcement

**Gate:** `POST /v1/queries` with a real AWS question returns JSON with a non-empty `answer` and ≥1 `citations` entry in <30s in prod. Degraded mode tested: MCP mocked-down, graph-only answer returned correctly.

---

### Week 5 — Frontend (2026-07-14 to 2026-07-20)
**Focus:** Working UI end-to-end in the browser.

**Next.js 15 App Router (TypeScript):**
- Project scaffold on Vercel hobby tier
- Supabase Auth client: invite-only signup, email+password login, httpOnly cookie session, protected route middleware
- TanStack Query: base client configured against `https://api.<domain>`, Authorization header from session

**Pages:**
- `/` — landing / redirect to `/ask` if authenticated
- `/login` — Supabase Auth UI
- `/ask` — question input, answer display with inline `[n]` citation markers, citations panel (ranked list of doc URLs with snippets), related-docs panel (hop-count + edge-path displayed)
- `/history` — paginated query history (title + date + status)
- `/queries/[id]` — full query detail (answer + citations + related docs + metadata)
- `/account` — display name, daily cost used today

**UX details:**
- Degraded mode banners (3 variants from design doc section 8.5)
- Loading skeleton states
- Error boundaries with user-friendly messages

**Testing:**
- Vitest + RTL unit tests on key components
- Vitest + MSW integration tests: happy path + error states + degraded banners
- CI: lint-web, test-web jobs

**Gate:** A signed-in user can submit a question at `yourdomain.com/ask` and see an answer with citations and related docs rendered in the browser. History page shows previous queries. Degraded banner appears when backend simulates MCP-down.

---

### Week 6 — Graph atlas + observability + cost guardrails (2026-07-21 to 2026-07-27)
**Focus:** Graph visualizer live, dashboards wired, cost guardrails verified active.

**Java: graph endpoints:**
- `GET /v1/graph/overview` — top 2000 nodes by degree centrality from Neo4j; 24h cached materialized view (refreshed by ingest cron or manual trigger); response: `{nodes[], edges[]}`
- `GET /v1/graph/documents/{id}` — single document detail
- `GET /v1/graph/documents/{id}/neighbors?hops=1` — Cypher 1-hop expansion, cap 200 nodes
- `GET /v1/graph/search?q=...` — document title/URL substring search

**Frontend: graph pages:**
- `/graph` — `react-force-graph-2d` force-directed; color-by-service (deterministic color palette); click node → `/graph/[id]`; top 2000 nodes rendered
- `/graph/[id]` — neighborhood view (1-hop); node detail panel (title, URL, service, word_count)

**Observability:**
- CloudWatch EMF: all metrics from design doc section 9.6 emitted from both Lambdas
- AWS X-Ray: gateway → Java → Python traces; trace ID propagated via SigV4 headers
- CloudWatch Operations dashboard: query rate, p50/p99 latency, agent node durations, MCP health
- CloudWatch Cost dashboard: daily LLM spend by model, MCP call volume, Lambda cost

**Cost guardrails verification:**
- AWS Budgets: $10/mo budget with email alerts at 50/80/100% — confirm active in console
- AWS Cost Anomaly Detection: $5 threshold — confirm active
- SNS alarms: all 7 alarms from design doc section 9.6 wired and confirmed in console (test one)
- Outbound concurrency: `asyncio.Semaphore(5)` on LLM + MCP paths — integration test verifies

**Gate:** `/graph` renders ≥200 force-directed nodes color-coded by AWS service; click-through to `/graph/[id]` shows neighbors; Cost dashboard shows daily LLM spend metric; AWS Budget alarm confirmed active.

---

### Week 7 — Hardening sprint (2026-07-28 to 2026-08-03)
**Focus:** All 12 phase-1 validation criteria met. Project is done.

**Cloudflare + custom domain:**
- Register domain (or use existing), add to Cloudflare
- DNS: `yourdomain.com` → Vercel; `api.yourdomain.com` → API Gateway
- AWS ACM cert for `api.yourdomain.com`; API Gateway custom domain
- Cloudflare "Full (strict)" SSL mode
- Verify TLS end-to-end for both hostnames

**Deploy-prod pipeline (`deploy-prod.yml`):**
- Full pipeline: CI checks → terraform plan → manual approval gate (GitHub Environments) → terraform apply → Flyway migrate → Neo4j migrate → smoke tests
- Smoke test 1: `GET /v1/healthz` → 200
- Smoke test 2: canary query → non-empty answer, ≥1 citation, cost <$0.01
- Rollback procedure: re-run deploy-prod with previous SHA — verify it works

**Security verification:**
- RLS integration test: create user A + user B; user A cannot see user B's queries via `GET /v1/queries` or `GET /v1/queries/{id}` — test passes in CI
- ArchUnit rules passing in CI (already done week 2, re-verify)

**Cost regression script:**
- `tests/fixtures/questions.yaml`: 20 representative questions across all `question_type` values
- `scripts/cost-regression.sh`: runs all 20, computes total cost, alerts if >25% drift vs baseline
- Run once and record baseline

**Documentation:**
- `docs/runbooks/deploy.md` — step-by-step prod deploy procedure
- `docs/runbooks/rollback.md` — rollback to previous SHA
- `docs/runbooks/rotate-secrets.md` — rotate Anthropic key, Postgres passwords, Neo4j password
- `README.md` — updated with real getting-started instructions, first-query-in-30-min flow

**Final validation checklist (design doc section 14):**
1. [ ] Invite-only signup + login works
2. [ ] `/ask` returns answer with citations + related docs in <30s
3. [ ] `/graph` renders ≥200 nodes with color-by-service
4. [ ] Node drill-down shows 1-hop neighbors
5. [ ] ≥500 documents in Postgres + Neo4j (already done week 3)
6. [ ] CI green on `main`; deploy-prod runs end-to-end
7. [ ] CloudWatch dashboards show query rate, latency, daily LLM cost
8. [ ] AWS Budget at $10/mo with alarms verified active
9. [ ] RLS test: user A cannot read user B's queries
10. [ ] ArchUnit rules pass; hexagonal boundaries clean
11. [ ] README + 3 runbooks exist and are accurate
12. [ ] Cloudflare + custom domain attached

**Gate:** All 12 criteria checked off. Phase 1 is complete.

---

## 4. Summary timeline

| Week | Dates | Primary focus | Gate |
|---|---|---|---|
| 1 | 2026-06-16 to 2026-06-22 | Foundation: accounts, repo, local dev, migrations | `make dev` works on clean checkout |
| 2 | 2026-06-23 to 2026-06-29 | Java skeleton + CI + first prod deploy | healthz 200 in prod, CI green |
| 3 | 2026-06-30 to 2026-07-06 | Python + ingestion pipeline | ≥500 docs in prod Postgres + Neo4j |
| 4 | 2026-07-07 to 2026-07-13 | LangGraph agent + query API | real answer with citations in <30s |
| 5 | 2026-07-14 to 2026-07-20 | Next.js frontend | browser end-to-end working |
| 6 | 2026-07-21 to 2026-07-27 | Graph atlas + observability + guardrails | graph renders, dashboards live |
| 7 | 2026-07-28 to 2026-08-03 | Hardening: Cloudflare, deploy-prod, runbooks | all 12 validation criteria pass |

---

## 5. Dependency graph

```
Week 1 (Foundation)
  └── Week 2 (Java + CI)
        └── Week 3 (Python + Ingestion) ──┐
              └── Week 4 (Agent + Query)   │
                    └── Week 5 (Frontend)  │
                          └── Week 6 (Graph + Obs) ← needs Week 3 data
                                └── Week 7 (Hardening)
```

Week 6 also depends on Week 3 data (needs ≥500 docs for graph atlas to render meaningfully).

---

## 6. Out of scope

Everything in Phase 2 deferred items (design doc section 11). No task in this calendar touches:
- Personal browsing graph
- Open multi-tenancy
- Streaming / async query path
- Conversational threading
- Concept extraction
- E2E (Playwright) tests
- WAF / Cloudflare rate-limit rules
- Auto-rollback / canary deploys
- MFA / SSO
