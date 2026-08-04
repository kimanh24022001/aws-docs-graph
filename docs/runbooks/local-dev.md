# Local Dev Setup

## Prerequisites

- Colima (Docker runtime for macOS)
- Java 17, Maven
- Node 18+
- Python 3.12

## Start everything

```bash
# 1. Start Colima + Postgres + Neo4j
colima start
export DOCKER_HOST=unix:///Users/I753472/.colima/default/docker.sock
make dev

# 2. Apply pending migrations (run once after pulling new migrations)
make migrate

# 3. Start Java API (port 8083)
cd api-service && mvn spring-boot:run

# 4. Start Next.js (port 3000) — separate terminal
cd web && npm run dev

# 5. (Optional) Start Python agent service (port 8001)
cd agent-service && source .venv/bin/activate
uvicorn app.main:app --port 8001 --reload
```

## Verify services are up

```bash
curl http://localhost:8083/v1/graph/my-learning   # Java API
curl http://localhost:3000                         # Next.js
```

## Test the Learning Galaxy feature

1. Open `http://localhost:3000/ask` and ask any AWS question (e.g. "What is Lambda?")
2. Open `http://localhost:3000/galaxy` and click **My Learning**
3. Docs cited in your answer appear as nodes — click any node to open the AWS doc

Empty state (🌱) is shown until at least one question has been answered.

## Migrations

Flyway migrations live in `infra/migrations/postgres/`. They run automatically via `make migrate`.

Current migrations:
| File | Description |
|---|---|
| V1–V7 | Core schema (users, orgs, documents, queries, etc.) |
| V8__user_visits.sql | `app.user_visits` table for Learning Galaxy |

## Dev fallback user

When not logged in, the app uses:
- `user_id` = `00000000-0000-0000-0000-000000000001`
- `org_id`  = `00000000-0000-0000-0000-000000000001`

This user and org must exist in Postgres for queries to work. They are seeded by `make dev`.
