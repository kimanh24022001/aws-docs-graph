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
