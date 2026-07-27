# aws-docs-graph — CLAUDE.md

Project context and coding conventions for AI assistants.

---

## Stack Overview

| Layer | Technology | Port / Location |
|---|---|---|
| Frontend | Next.js 15 App Router + TypeScript | `web/` — localhost:3000 |
| API | Java 21 + Spring Boot 3 (hexagonal) | `api-service/` — localhost:8083 |
| Agent | Python 3.12 + FastAPI + LangGraph | `agent-service/` — localhost:8001 |
| Graph DB | Neo4j AuraDB (prod) / Docker (local) | bolt://localhost:7687 |
| Relational | Supabase Postgres (prod) / Docker (local) | localhost:5432 |
| Infra | Terraform + AWS Lambda | `infra/` |

---

## Key Commands

```bash
# Start local dev (Postgres + Neo4j)
make dev

# Python service
cd agent-service && source .venv/bin/activate
uvicorn app.main:app --port 8001 --reload

# Java service
cd api-service && mvn spring-boot:run

# Frontend
cd web && npm run dev

# Tests
cd agent-service && pytest tests/unit/ -v
cd api-service && DOCKER_HOST=unix:///Users/I753472/.colima/default/docker.sock mvn test
cd web && npm test

# Docker (always export this first on this machine)
export DOCKER_HOST=unix:///Users/I753472/.colima/default/docker.sock
```

---

## Architecture Rules

### Java (api-service) — Hexagonal Architecture
```
domain/          ← pure business objects, NO framework imports
application/     ← use cases + port interfaces
adapter/in/      ← @RestController, DTOs
adapter/out/     ← Neo4j, Postgres, agent HTTP client
infrastructure/  ← Spring config, Lambda handler
```
- **Never** put business logic in controllers
- **Never** import framework annotations into `domain/`
- `adapter/in` must not depend on `adapter/out`
- ArchUnit tests enforce these rules — run `mvn test` before committing

### Python (agent-service) — FastAPI modules
```
app/agents/     ← LangGraph pipeline (plan→search→traverse→synthesize)
app/graph/      ← Neo4j graph operations (clustering, evidence, relationships)
app/ingest/     ← AWS docs crawling + ingestion
app/db/         ← asyncpg pool + neo4j driver factories
```
- All DB functions are async — use `await`
- `get_pool()` and `get_driver()` are singletons with asyncio.Lock
- Every ingest endpoint is **idempotent** (Postgres `ON CONFLICT`, Neo4j `MERGE`)

### Frontend (web) — Next.js App Router
```
app/             ← pages (ask, history, graph, galaxy, account)
components/      ← reusable UI + 3D galaxy components
lib/api.ts       ← TanStack Query hooks + apiFetch()
lib/categories.ts← service → category mapping (mirrors Java ServiceCategory.java)
```
- Graph/galaxy pages use `skipAuth=true` in `apiFetch` (public data)
- 3D galaxy uses React Three Fiber — always `dynamic()` with `ssr: false` for Three.js components
- `categoryFor()` and `categoryColor()` must stay in sync with Java `ServiceCategory.java`

---

## Critical Rules

1. **Secrets never in git** — all secrets in AWS Parameter Store (`/adg/prod/*`) or local `.env` (gitignored)
2. **No SQL injection** — always use parameterised queries (`$1, $2`, never f-strings for user input)
3. **Service names are lowercase canonical** — `ec2` not `AWSEC2`, `sdk` not `sdkfornet` (see `_normalize_service()`)
4. **Ingest endpoints are idempotent** — re-running must produce same result
5. **Ingest lock** — check `crawl_cursor WHERE id='lock'` before starting sitemap/bootstrap; return 409 if `RUNNING`
6. **No PII in logs** — logs never contain question/answer text, JWTs, API keys, or email addresses
7. **Cost cap** — per-user LLM cap $0.50/day enforced in `QueryService.java`; Lambda reserved concurrency=5

---

## Common Flows

### Adding a new API endpoint

1. Add method signature to `GraphRepository.java` (port.out interface)
2. Implement in `Neo4jGraphClient.java` (Cypher query)
3. Expose in `GalaxyController.java` or `GraphController.java`
4. Add `fetchXxx()` to `web/lib/api.ts`
5. Add to `web/lib/types.ts` if new response type needed

### Adding a new ingest/graph Python endpoint

1. Create or edit file in `agent-service/app/graph/` or `app/ingest/`
2. Add `router = APIRouter()` + `@router.post(...)`
3. Register in `agent-service/app/main.py`: `app.include_router(xxx_router)`
4. Write unit tests in `agent-service/tests/unit/`

### Adding a new AWS service relationship (evidence edge)

1. Seed in Neo4j:
   ```cypher
   MATCH (a:Document {service: 'lambda'}), (b:Document {service: 'sqs'})
   WHERE a.placeholder IS NULL AND b.placeholder IS NULL WITH a, b LIMIT 1
   MERGE (a)-[r:CROSS_SERVICE {rel_type: 'TRIGGERED_BY'}]->(b)
   SET r.evidence_text='...', r.source_url='...', r.confidence=0.92, r.extraction_method='rule_based'
   ```
2. Galaxy Level 1 auto-fetches via `GET /v1/graph/services/{service}/evidence-edges` — no frontend change needed

### Adding a new service → category mapping

1. Add to `_SERVICE_ALIASES` in `agent-service/app/ingest/page.py`
2. Add to `CANONICAL_MAP` in `agent-service/app/graph/standardize.py`
3. Add to `ServiceCategory.java` in `api-service/`
4. Add to `web/lib/categories.ts`
5. Run `POST /internal/graph/standardize-entities` to migrate existing data

### Running entity standardization (fix duplicate service names)

```bash
curl -X POST http://localhost:8001/internal/graph/standardize-entities
```

### Deploying to prod

See `docs/runbooks/deploy.md`

---

## Directory Structure

```
aws-docs-graph/
├── .github/workflows/    ci.yml, deploy-prod.yml
├── infra/                Terraform: modules/, envs/prod/
│   └── migrations/       postgres/ (Flyway V1-V7), neo4j/ (V1-V2)
├── api-service/          Java Spring Boot 3 (hexagonal)
├── agent-service/        Python FastAPI + LangGraph
├── web/                  Next.js 15 App Router
├── docs/
│   ├── superpowers/specs/   design specs
│   ├── superpowers/plans/   implementation plans
│   └── runbooks/            deploy, rollback, rotate-secrets
├── scripts/              bootstrap-aws.sh, neo4j-migrate.sh
├── .claude/workflows/    execute-plan-day.js (SDD workflow)
└── Makefile              dev, migrate, stop, clean
```

---

## When Starting a New Feature

1. Check `docs/superpowers/specs/` for existing design
2. Run brainstorming skill if no spec exists: `/superpowers:brainstorming`
3. Write plan: `/superpowers:writing-plans`
4. Execute: `/superpowers:subagent-driven-development` (recommended) or `/superpowers:executing-plans`
