-- Actions lined up to run once the family has actually joined.
--
-- The team wants to set a group's follow-up going before anyone is in it: pick
-- the assessments, the mentor and a booking link while the case is still
-- AWAITING_JOIN, and have them go out in order once the welcome has fired.
--
-- This is a queue of INTENT, kept separate from case_actions on purpose.
-- case_actions stays what it has always been: the record of messages actually
-- sent, one row per send, with the actor and the idempotency key. A queued row
-- produces a case_actions row when it runs, and points at it.
--
-- Run once in the Supabase SQL editor.

create table if not exists public.queued_actions (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.group_cases (id) on delete cascade,

  -- Order within this case's queue. Ascending; ties broken by created_at.
  position integer not null,

  kind text not null
    check (kind in ('ADD_MENTOR', 'CS_ASSESSMENT', 'PROTOTYPING_ASSESSMENT', 'SCHEDULE_MEETING')),

  /*
   * What the action needs when it eventually runs, by kind:
   *   ADD_MENTOR             { mentor, variant? }
   *   CS_/PROTOTYPING_       { deadline_days }
   *   SCHEDULE_MEETING       { host }
   *
   * Assessment deadlines are stored as a NUMBER OF DAYS, not a date. A queued
   * action can sit for a week waiting on a family to join, and a calendar date
   * picked at queue time would arrive stale or already past. The date is
   * worked out from this at send time, so the family always gets a full window.
   */
  params jsonb not null default '{}'::jsonb,

  status text not null default 'QUEUED'
    check (status in ('QUEUED', 'SENT', 'FAILED', 'CANCELLED')),

  -- The send this produced, so the queue can be traced to the real message.
  case_action_id uuid references public.case_actions (id) on delete set null,

  queued_by  text,
  error      text,
  attempts   integer not null default 0,
  sent_at    timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- The runner's two questions: "what is queued for this case, in order?" and
-- "which cases have anything queued at all?".
create index if not exists queued_actions_case_position_idx
  on public.queued_actions (case_id, position, created_at);
create index if not exists queued_actions_pending_idx
  on public.queued_actions (case_id) where status = 'QUEUED';

-- Same lockdown as the sibling tables: RLS on, no policies, service key only.
alter table public.queued_actions enable row level security;
revoke all on public.queued_actions from anon, authenticated;
