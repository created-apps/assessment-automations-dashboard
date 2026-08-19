-- Invite-only user store for the CreatED operations dashboard.
-- Run this once against your Postgres database (DATABASE_URL), then use
-- `pnpm seed:user` / `pnpm invite:user` to add accounts. There is NO public
-- sign-up path — accounts only exist because an admin created them here.

create extension if not exists "pgcrypto";

create table if not exists public.dashboard_users (
  id            uuid primary key default gen_random_uuid(),
  email         text not null unique,
  name          text not null,
  role          text not null default 'viewer' check (role in ('admin', 'viewer')),
  password_hash text not null,
  is_active     boolean not null default true,
  last_login_at timestamptz,
  created_at    timestamptz not null default now()
);

-- Emails are always stored lowercase/trimmed by the app, but enforce
-- case-insensitive uniqueness at the database level too.
create unique index if not exists dashboard_users_email_lower_idx
  on public.dashboard_users (lower(email));

-- Lock the table down.
--
-- This sits in `public`, which Supabase exposes over PostgREST — without this,
-- the anon key could read every row, and every row contains an email and a
-- bcrypt password hash. RLS on with no policies means anon and authenticated
-- get nothing at all.
--
-- The dashboard is unaffected: it connects over plain Postgres as the table's
-- owner, and an owner is not subject to its own RLS unless FORCE is set.
alter table public.dashboard_users enable row level security;

-- Belt and braces: PostgREST's roles have no business here even if a policy is
-- ever added by mistake.
revoke all on public.dashboard_users from anon, authenticated;
