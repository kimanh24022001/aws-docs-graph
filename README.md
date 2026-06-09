# aws-docs-graph

> An AWS documentation knowledge-graph assistant — a full-SDLC learning project.

You ask a natural-language question about AWS; the system returns an answer
grounded in real AWS documentation **with citations** and a **panel of
related documents** discovered by traversing a knowledge graph built from the
AWS docs corpus.

## Why this exists

This is a deliberate practice project that exercises every layer of a modern
backend system end to end:

- Frontend (Next.js + TypeScript)
- Edge / DNS (Cloudflare, deferred to phase-1 hardening)
- API gateway with JWT-based auth (AWS API Gateway + Supabase Auth)
- Backend, transactional API (Java + Spring Boot 3, hexagonal, on AWS Lambda + SnapStart)
- Backend, ingestion + agents (Python + FastAPI + LangGraph, on AWS Lambda)
- Object storage (S3 — deferred to phase 2)
- Relational + RLS (Supabase Postgres)
- Graph DB (Neo4j AuraDB Free — built-in support for visualising the doc graph)
- LLM integration (Anthropic Claude with prompt caching)
- AWS Knowledge MCP server for retrieval (`https://knowledge-mcp.global.api.aws`)
- CI/CD (GitHub Actions)
- IaC (Terraform — AWS + Cloudflare)
- Observability (CloudWatch logs / metrics / X-Ray traces; alarms via SNS)
- Cost guardrails layered at every level (AWS Budgets, anomaly detection,
  per-user app-level cap, outbound concurrency limits, Anthropic console cap)

## Status

**Phase 1 — design complete, implementation not yet started.**

- Design doc: [`docs/superpowers/specs/2026-06-04-aws-docs-graph-design.md`](docs/superpowers/specs/2026-06-04-aws-docs-graph-design.md)
- Implementation plan: in `docs/superpowers/plans/` (added next)
- Runbooks (deploy / rollback / rotate-secrets): in `docs/runbooks/` once each is exercised

## Cost ceiling

Phase 1 targets **~$10/month maximum**, hard-capped via:

- AWS Budgets ($10/mo with email alerts at 50/80/100%)
- AWS Cost Anomaly Detection ($5 threshold)
- Per-user app-level LLM spend cap ($0.50/day)
- Outbound LLM and MCP concurrency limits (5)
- Anthropic console monthly hard cap ($20)
- CloudWatch log retention (14 days, Terraform-enforced)

## High-level architecture

```
Browser → Cloudflare → API Gateway (Lambda authoriser, JWT)
        → Java api-service (Spring Boot, hexagonal, SnapStart)
            → Python agent-service (FastAPI, internal-only via IAM SigV4)
                ├── AWS Knowledge MCP server (retrieval)
                ├── Anthropic Claude (planning + synthesis)
                ├── Supabase Postgres (documents, queries, audit, telemetry)
                └── Neo4j AuraDB (Document graph)

EventBridge (Mondays 02:00 UTC) → ingest cron → Python /ingest/sitemap
```

The full architecture, data model, security model, and SDLC plumbing are
described in the design doc.

## Repo layout (planned)

```
aws-docs-graph/
├── .github/workflows/    — ci.yml, deploy-prod.yml, reusable/
├── infra/                — Terraform: modules/, envs/{prod}/
├── api-service/          — Java Spring Boot 3 (hexagonal)
├── agent-service/        — Python FastAPI + LangGraph
├── web/                  — Next.js 15 App Router
├── docs/                 — superpowers/specs, superpowers/plans, runbooks, architecture
├── scripts/              — bootstrap-aws.sh, rotate-secrets.sh, seed-dev.sh
└── README.md
```

The implementation plan creates these directories incrementally — each task
produces a working, testable change with its own commit.

## Getting started

Phase 1 hasn't been built yet. Once it is, the local-development loop is:

```bash
make dev
```

which boots a Dockerised Postgres + Neo4j, runs migrations, starts both
backends, starts the Next.js frontend, and stubs the Python service from
Java's perspective with WireMock. New laptop → first running query in ~30
minutes.

## License

[MIT](LICENSE)
