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
