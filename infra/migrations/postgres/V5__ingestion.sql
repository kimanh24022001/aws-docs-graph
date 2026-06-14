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
