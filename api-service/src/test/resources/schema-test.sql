-- Schema init for integration tests
-- Applies all migrations in sequence (without Flyway)

create schema if not exists app;

-- V1: Identity
create table if not exists app.users (
  id           uuid primary key,
  display_name text,
  role         text not null default 'member' check (role in ('member', 'admin')),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create table if not exists app.organizations (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  slug        text unique not null,
  is_personal boolean not null default true,
  created_at  timestamptz not null default now()
);

create table if not exists app.org_memberships (
  org_id    uuid not null references app.organizations(id) on delete cascade,
  user_id   uuid not null references app.users(id) on delete cascade,
  role      text not null default 'member' check (role in ('owner', 'admin', 'member')),
  joined_at timestamptz not null default now(),
  primary key (org_id, user_id)
);

-- V2: Documents
create table if not exists app.documents (
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

-- V3: Queries
create table if not exists app.queries (
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

create unique index if not exists queries_idempotency_idx
  on app.queries(user_id, idempotency_key) where idempotency_key is not null;

alter table app.queries enable row level security;

drop policy if exists queries_user_isolation on app.queries;
create policy queries_user_isolation on app.queries
  for all
  using (
    org_id in (
      select org_id from app.org_memberships where user_id = current_setting('app.current_user_id', true)::uuid
    )
  );

-- V4: Telemetry (subset needed for getDailyLlmCostForUser)
create table if not exists app.agent_runs (
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

create table if not exists app.llm_calls (
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
