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
