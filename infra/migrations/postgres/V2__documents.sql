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
