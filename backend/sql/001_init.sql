-- Tables for the assessment follow-up service.
--
-- These live in the same database as the group-creation service, in `public`,
-- and are reached over the Supabase REST API with the service key -- there is
-- no ORM and no migration tool on this side. Run this once, in the Supabase
-- SQL editor.
--
-- Statuses are TEXT with a CHECK rather than Postgres enums: a new value is
-- then an ALTER of one constraint instead of an ALTER TYPE, and there is no
-- enum type sitting in `public` to collide with the other service's.

create table if not exists public.group_cases (
  id uuid primary key default gen_random_uuid(),

  -- Periskope chat id: the address messages are sent to, and the natural key
  -- for the group, so a replayed handover updates rather than duplicates.
  chat_id text not null unique,
  group_name text not null,

  student_name text not null,
  student_phone text,
  student_email text,
  parent_name text,
  parent_phone text,
  parent_email text,
  project_name text,

  -- Provenance from the group-creation service.
  source text,
  sheet_row integer,
  group_request_id text,
  supabase_group_id text,
  invite_link text,

  -- The handover body exactly as received, for replay and debugging.
  payload jsonb not null,

  -- NEW            -> asked in Slack, nothing sent yet
  -- IN_PROGRESS    -> an assessment or booking link went out, mentor still open
  -- MENTOR_ASSIGNED-> mentor intro delivered; terminal, no longer nudged
  -- ABANDONED      -> nudged too long with no mentor, stopped asking
  stage text not null default 'NEW'
    check (stage in ('NEW', 'IN_PROGRESS', 'MENTOR_ASSIGNED', 'ABANDONED')),

  -- The directory's canonical spelling next to what Slack actually typed, so a
  -- bad fuzzy match can be spotted after the fact.
  mentor_name text,
  mentor_requested_name text,
  mentor_intro_sent_at timestamptz,

  slack_channel text not null,
  -- Replies are matched back to a case by the thread they land in.
  slack_thread_ts text not null unique,

  last_nudged_at timestamptz,
  nudge_count integer not null default 0,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists group_cases_stage_idx on public.group_cases (stage);
create index if not exists group_cases_created_at_idx on public.group_cases (created_at);

-- One instruction read out of a Slack thread, and what came of it.
create table if not exists public.case_actions (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.group_cases (id) on delete cascade,

  kind text not null
    check (kind in ('ADD_MENTOR', 'CS_ASSESSMENT', 'PROTOTYPING_ASSESSMENT', 'SCHEDULE_MEETING')),

  -- The reply verbatim, so an action can always be traced to its source.
  command text not null,
  slack_user text,

  -- Slack retries event deliveries, and a message timestamp is unique per
  -- message: this constraint is what stops one reply being acted on twice.
  -- The insert relies on it (ON CONFLICT DO NOTHING), so it must stay unique.
  slack_ts text not null unique,

  -- Whatever the handler resolved: matched mentor, deadline, booking target.
  detail jsonb,
  -- PENDING is written before anything is sent, so a crash mid-send leaves
  -- evidence rather than silence.
  status text not null
    check (status in ('PENDING', 'OK', 'FAILED')),
  error text,

  created_at timestamptz not null default now()
);

create index if not exists case_actions_case_id_idx on public.case_actions (case_id);

-- Both tables sit in `public`, which Supabase exposes over PostgREST, so RLS
-- has to be on or the anon key could read every family's details. No policies
-- are defined on purpose: with RLS on and no policy, anon and authenticated
-- get nothing, while the service key this service uses bypasses RLS entirely.
alter table public.group_cases enable row level security;
alter table public.case_actions enable row level security;
