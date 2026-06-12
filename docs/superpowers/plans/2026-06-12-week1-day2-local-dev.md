# Week 1 Day 2 — Local Dev Environment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `make dev` brings up Postgres + Neo4j in Docker, runs all Flyway migrations, applies Neo4j constraints, and prints healthy connection info — so any developer can go from clone to running databases in one command.

**Architecture:** Docker Compose manages both databases with persistent named volumes. Flyway handles Postgres schema via SQL migration files versioned in `infra/migrations/`. A small shell script applies Neo4j Cypher constraints via the `cypher-shell` Docker exec. `make dev` orchestrates the whole sequence.

**Tech Stack:** Docker Compose, Postgres 16, Neo4j 5, Flyway CLI (Docker image), cypher-shell

---

## File Structure

```
docker-compose.yml                     Postgres + Neo4j services
infra/
└── migrations/
    ├── postgres/
    │   ├── V1__identity.sql           users · organizations · org_memberships
    │   ├── V2__documents.sql          documents + indexes
    │   ├── V3__queries.sql            queries · query_citations · query_related_docs + RLS
    │   ├── V4__telemetry.sql          agent_runs · llm_calls · mcp_search_log · mcp_cache
    │   ├── V5__ingestion.sql          crawl_log · crawl_cursor · idempotency_keys
    │   └── V6__triggers.sql           auto-create personal org on user insert
    └── neo4j/
        └── V1__constraints.cypher     document constraints + indexes
Makefile                               dev, migrate targets (updated)
scripts/
└── neo4j-migrate.sh                   applies cypher constraints via docker exec
```

---

### Task 1: Create Docker Compose file

- [ ] **Step 1: Create `docker-compose.yml`**

  ```yaml
  services:
    postgres:
      image: postgres:16
      environment:
        POSTGRES_USER: postgres
        POSTGRES_PASSWORD: postgres
        POSTGRES_DB: postgres
      ports:
        - "5432:5432"
      volumes:
        - postgres_data:/var/lib/postgresql/data
      healthcheck:
        test: ["CMD-SHELL", "pg_isready -U postgres"]
        interval: 5s
        timeout: 5s
        retries: 10

    neo4j:
      image: neo4j:5
      environment:
        NEO4J_AUTH: neo4j/devpassword
        NEO4J_PLUGINS: '["apoc"]'
        NEO4J_dbms_memory_heap_initial__size: 256m
        NEO4J_dbms_memory_heap_max__size: 512m
      ports:
        - "7474:7474"   # Browser UI
        - "7687:7687"   # Bolt
      volumes:
        - neo4j_data:/data
        - neo4j_logs:/logs
      healthcheck:
        test: ["CMD-SHELL", "wget -qO- http://localhost:7474 || exit 1"]
        interval: 10s
        timeout: 10s
        retries: 20

  volumes:
    postgres_data:
    neo4j_data:
    neo4j_logs:
  ```

- [ ] **Step 2: Start and verify**

  ```bash
  docker compose up -d
  docker compose ps
  ```

  Expected: both services `healthy`.

  ```bash
  docker compose logs postgres | tail -5
  ```
  Expected: `database system is ready to accept connections`

  ```bash
  docker compose logs neo4j | tail -5
  ```
  Expected: `Started.`

- [ ] **Step 3: Commit**

  ```bash
  git add docker-compose.yml
  git commit -m "chore: add Docker Compose for local Postgres + Neo4j"
  ```

---

### Task 2: Postgres migrations V1 — Identity tables

- [ ] **Step 1: Create migration file**

  Create `infra/migrations/postgres/V1__identity.sql`:
  ```sql
  create schema if not exists app;

  create table app.users (
    id           uuid primary key,
    display_name text,
    role         text not null default 'member' check (role in ('member', 'admin')),
    created_at   timestamptz not null default now(),
    updated_at   timestamptz not null default now()
  );

  create table app.organizations (
    id          uuid primary key default gen_random_uuid(),
    name        text not null,
    slug        text unique not null,
    is_personal boolean not null default true,
    created_at  timestamptz not null default now()
  );

  create table app.org_memberships (
    org_id    uuid not null references app.organizations(id) on delete cascade,
    user_id   uuid not null references app.users(id) on delete cascade,
    role      text not null default 'member' check (role in ('owner', 'admin', 'member')),
    joined_at timestamptz not null default now(),
    primary key (org_id, user_id)
  );
  ```

  Note: `app.users.id` is a plain UUID (no foreign key to `auth.users`) in local dev. Supabase prod adds the `references auth.users(id)` constraint automatically via Supabase Auth.

- [ ] **Step 2: Run Flyway via Docker**

  ```bash
  docker run --rm \
    --network host \
    -v "$(pwd)/infra/migrations/postgres:/flyway/sql" \
    flyway/flyway:10 \
    -url=jdbc:postgresql://localhost:5432/postgres \
    -user=postgres \
    -password=postgres \
    -schemas=app \
    migrate
  ```

  Expected output:
  ```
  Successfully applied 1 migration to schema "app" (execution time 00:00.123s)
  ```

- [ ] **Step 3: Verify**

  ```bash
  docker exec -it $(docker compose ps -q postgres) \
    psql -U postgres -c "\dt app.*"
  ```

  Expected: lists `users`, `organizations`, `org_memberships`.

---

### Task 3: Postgres migrations V2–V6

- [ ] **Step 1: Create V2 — documents**

  Create `infra/migrations/postgres/V2__documents.sql`:
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

  create index documents_service_idx      on app.documents(service);
  create index documents_url_hash_idx     on app.documents(url_hash);
  create index documents_last_crawled_idx on app.documents(last_crawled_at);
  create index documents_status_idx       on app.documents(status);
  ```

- [ ] **Step 2: Create V3 — queries + RLS**

  Create `infra/migrations/postgres/V3__queries.sql`:
  ```sql
  create table app.queries (
    id               uuid primary key default gen_random_uuid(),
    user_id          uuid not null references app.users(id),
    org_id           uuid not null references app.organizations(id),
    thread_id        uuid,
    question         text not null,
    question_hash    text not null,
    status           text not null default 'pending'
                       check (status in ('pending', 'running', 'succeeded', 'failed', 'cancelled')),
    answer           text,
    agent_run_id     uuid,
    duration_ms      int,
    total_cost_usd   numeric(10,6),
    total_tokens_in  int,
    total_tokens_out int,
    error_code       text,
    error_message    text,
    idempotency_key  text,
    created_at       timestamptz not null default now(),
    completed_at     timestamptz
  );

  create index queries_user_id_created_idx on app.queries(user_id, created_at desc);
  create index queries_org_id_created_idx  on app.queries(org_id, created_at desc);
  create unique index queries_idempotency_idx
    on app.queries(user_id, idempotency_key) where idempotency_key is not null;

  alter table app.queries enable row level security;
  create policy queries_user_isolation on app.queries
    for all
    using (
      org_id in (
        select org_id from app.org_memberships where user_id = current_setting('app.current_user_id')::uuid
      )
    );

  create table app.query_citations (
    query_id    uuid not null references app.queries(id) on delete cascade,
    document_id uuid not null references app.documents(id),
    rank        int  not null,
    score       real,
    snippet     text,
    source_kind text not null check (source_kind in ('mcp_search', 'graph_traversal')),
    primary key (query_id, document_id, source_kind)
  );

  create table app.query_related_docs (
    query_id    uuid not null references app.queries(id) on delete cascade,
    document_id uuid not null references app.documents(id),
    hop_count   int  not null default 1,
    edge_path   text[],
    primary key (query_id, document_id)
  );
  ```

  Note: RLS uses `current_setting('app.current_user_id')` for local dev. Supabase prod uses `auth.uid()` — the Java service sets this per-request via `SET LOCAL "app.current_user_id" = '...'`.

- [ ] **Step 3: Create V4 — telemetry**

  Create `infra/migrations/postgres/V4__telemetry.sql`:
  ```sql
  create table app.agent_runs (
    id          uuid primary key default gen_random_uuid(),
    query_id    uuid not null references app.queries(id) on delete cascade,
    user_id     uuid not null references app.users(id),
    org_id      uuid not null references app.organizations(id),
    status      text not null default 'running'
                  check (status in ('running', 'succeeded', 'failed', 'budget_exceeded')),
    started_at  timestamptz not null default now(),
    finished_at timestamptz,
    graph_state jsonb not null default '{}',
    step_log    jsonb not null default '[]'
  );

  create table app.llm_calls (
    id               uuid primary key default gen_random_uuid(),
    query_id         uuid references app.queries(id) on delete set null,
    agent_run_id     uuid references app.agent_runs(id) on delete set null,
    source           text not null,
    provider         text not null,
    model            text not null,
    prompt_cache_hit boolean,
    input_tokens     int,
    output_tokens    int,
    cost_usd         numeric(10,6),
    latency_ms       int,
    created_at       timestamptz not null default now()
  );

  create table app.mcp_search_log (
    id             uuid primary key default gen_random_uuid(),
    query_id       uuid references app.queries(id) on delete set null,
    agent_run_id   uuid references app.agent_runs(id) on delete set null,
    tool_name      text not null,
    input          jsonb not null,
    result_summary jsonb,
    status         text not null check (status in ('ok', 'rate_limited', 'error', 'timeout')),
    http_status    int,
    latency_ms     int,
    created_at     timestamptz not null default now()
  );

  create table app.mcp_cache (
    cache_key  text primary key,
    tool_name  text not null,
    input      jsonb not null,
    result     jsonb not null,
    expires_at timestamptz not null,
    created_at timestamptz not null default now()
  );
  ```

- [ ] **Step 4: Create V5 — ingestion bookkeeping**

  Create `infra/migrations/postgres/V5__ingestion.sql`:
  ```sql
  create table app.crawl_log (
    id          uuid primary key default gen_random_uuid(),
    run_id      uuid not null,
    url         text not null,
    outcome     text not null check (outcome in ('new', 'unchanged', 'updated', 'gone', 'failed')),
    http_status int,
    error       text,
    document_id uuid references app.documents(id),
    duration_ms int,
    created_at  timestamptz not null default now()
  );

  create table app.crawl_cursor (
    id         text primary key,
    last_url   text,
    updated_at timestamptz not null default now()
  );

  create table app.idempotency_keys (
    key           text primary key,
    user_id       uuid not null references app.users(id),
    resource_type text not null,
    resource_id   uuid not null,
    request_hash  text not null,
    created_at    timestamptz not null default now(),
    expires_at    timestamptz not null
  );
  ```

- [ ] **Step 5: Create V6 — personal org trigger**

  Create `infra/migrations/postgres/V6__triggers.sql`:
  ```sql
  create or replace function app.create_personal_org()
  returns trigger language plpgsql as $$
  declare
    org_id uuid := gen_random_uuid();
  begin
    insert into app.organizations(id, name, slug, is_personal)
    values (org_id, 'Personal', new.id::text, true);

    insert into app.org_memberships(org_id, user_id, role)
    values (org_id, new.id, 'owner');

    return new;
  end;
  $$;

  create trigger on_user_created
    after insert on app.users
    for each row execute function app.create_personal_org();
  ```

- [ ] **Step 6: Run all remaining migrations**

  ```bash
  docker run --rm \
    --network host \
    -v "$(pwd)/infra/migrations/postgres:/flyway/sql" \
    flyway/flyway:10 \
    -url=jdbc:postgresql://localhost:5432/postgres \
    -user=postgres \
    -password=postgres \
    -schemas=app \
    migrate
  ```

  Expected:
  ```
  Successfully applied 5 migrations to schema "app" (execution time 00:00.456s)
  ```

- [ ] **Step 7: Verify all tables exist**

  ```bash
  docker exec -it $(docker compose ps -q postgres) \
    psql -U postgres -c "\dt app.*"
  ```

  Expected output lists all 12 tables:
  ```
  users, organizations, org_memberships, documents, queries, query_citations,
  query_related_docs, agent_runs, llm_calls, mcp_search_log, mcp_cache,
  crawl_log, crawl_cursor, idempotency_keys
  ```

- [ ] **Step 8: Commit migrations**

  ```bash
  git add infra/migrations/postgres/
  git commit -m "feat: add Flyway migrations V1-V6 (all Phase 1 tables + RLS + trigger)"
  ```

---

### Task 4: Neo4j constraints and indexes

- [ ] **Step 1: Create Cypher migration file**

  Create `infra/migrations/neo4j/V1__constraints.cypher`:
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

- [ ] **Step 2: Create neo4j-migrate.sh**

  Create `scripts/neo4j-migrate.sh`:
  ```bash
  #!/usr/bin/env bash
  set -euo pipefail

  NEO4J_URI="${NEO4J_URI:-bolt://localhost:7687}"
  NEO4J_USERNAME="${NEO4J_USERNAME:-neo4j}"
  NEO4J_PASSWORD="${NEO4J_PASSWORD:-devpassword}"
  MIGRATIONS_DIR="$(dirname "$0")/../infra/migrations/neo4j"

  echo "Applying Neo4j migrations from $MIGRATIONS_DIR..."

  for f in "$MIGRATIONS_DIR"/*.cypher; do
    echo "  → $(basename "$f")"
    docker exec -i "$(docker compose ps -q neo4j)" \
      cypher-shell -u "$NEO4J_USERNAME" -p "$NEO4J_PASSWORD" \
      < "$f"
  done

  echo "Neo4j migrations done."
  ```

  ```bash
  chmod +x scripts/neo4j-migrate.sh
  ```

- [ ] **Step 3: Run Neo4j migrations**

  ```bash
  ./scripts/neo4j-migrate.sh
  ```

  Expected:
  ```
  Applying Neo4j migrations from .../infra/migrations/neo4j...
    → V1__constraints.cypher
  Neo4j migrations done.
  ```

- [ ] **Step 4: Verify constraints**

  ```bash
  docker exec -it $(docker compose ps -q neo4j) \
    cypher-shell -u neo4j -p devpassword \
    "SHOW CONSTRAINTS"
  ```

  Expected: 2 constraints listed (`document_id_unique`, `document_url_unique`).

  ```bash
  docker exec -it $(docker compose ps -q neo4j) \
    cypher-shell -u neo4j -p devpassword \
    "SHOW INDEXES"
  ```

  Expected: 2 indexes listed plus the constraint-backing indexes.

- [ ] **Step 5: Commit**

  ```bash
  git add infra/migrations/neo4j/ scripts/neo4j-migrate.sh
  git commit -m "feat: add Neo4j constraint + index migrations"
  ```

---

### Task 5: Wire `make dev`

- [ ] **Step 1: Update Makefile**

  Replace the stub `Makefile` with:
  ```makefile
  .PHONY: dev migrate migrate-postgres migrate-neo4j stop clean

  dev: ## Start local databases, run all migrations
  	docker compose up -d
  	@echo "Waiting for databases to be healthy..."
  	@until docker compose ps | grep -E "postgres.*healthy" > /dev/null 2>&1; do sleep 1; done
  	@until docker compose ps | grep -E "neo4j.*healthy" > /dev/null 2>&1; do sleep 1; done
  	$(MAKE) migrate
  	@echo ""
  	@echo "✅ Local dev ready"
  	@echo "   Postgres:  postgresql://postgres:postgres@localhost:5432/postgres"
  	@echo "   Neo4j UI:  http://localhost:7474  (neo4j / devpassword)"
  	@echo "   Neo4j Bolt: bolt://localhost:7687"

  migrate: migrate-postgres migrate-neo4j ## Run all migrations

  migrate-postgres: ## Run Flyway Postgres migrations
  	docker run --rm \
  		--network host \
  		-v "$$(pwd)/infra/migrations/postgres:/flyway/sql" \
  		flyway/flyway:10 \
  		-url=jdbc:postgresql://localhost:5432/postgres \
  		-user=postgres \
  		-password=postgres \
  		-schemas=app \
  		migrate

  migrate-neo4j: ## Run Neo4j Cypher migrations
  	./scripts/neo4j-migrate.sh

  stop: ## Stop local databases (keeps data)
  	docker compose stop

  clean: ## Stop and remove all data volumes (destructive!)
  	docker compose down -v
  	@echo "All volumes removed."
  ```

- [ ] **Step 2: Test `make clean` then `make dev` from scratch**

  ```bash
  make clean
  make dev
  ```

  Expected final output:
  ```
  ✅ Local dev ready
     Postgres:  postgresql://postgres:postgres@localhost:5432/postgres
     Neo4j UI:  http://localhost:7474  (neo4j / devpassword)
     Neo4j Bolt: bolt://localhost:7687
  ```

  And Flyway output shows: `Successfully applied 6 migrations to schema "app"`

- [ ] **Step 3: Verify data integrity after fresh start**

  ```bash
  # Postgres: all tables present
  docker exec -it $(docker compose ps -q postgres) \
    psql -U postgres -c "SELECT tablename FROM pg_tables WHERE schemaname='app' ORDER BY tablename"

  # Neo4j: constraints present
  docker exec -it $(docker compose ps -q neo4j) \
    cypher-shell -u neo4j -p devpassword "SHOW CONSTRAINTS"
  ```

- [ ] **Step 4: Commit**

  ```bash
  git add Makefile
  git commit -m "feat: make dev boots Postgres + Neo4j and runs all migrations"
  ```

---

### Day 2 Done

Verify:
- [ ] `make clean && make dev` completes with ✅ message
- [ ] Flyway shows 6 migrations applied
- [ ] All 12 app tables exist in Postgres
- [ ] Neo4j has 2 constraints + 2 indexes
- [ ] `git log --oneline` shows 5 commits total (3 from Day 1 + 2 today)
