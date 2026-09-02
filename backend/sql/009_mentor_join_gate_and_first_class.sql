-- The mentor introduction waits for the mentor, and the first class gets chased.
--
-- Two changes, one migration because both add columns to group_cases. Run once
-- in the Supabase SQL editor, like the others.
--
-- 1. The introduction used to go into the group the moment a mentor was picked,
--    whether or not the mentor was in the group to answer it. It is now held
--    until they actually appear in the WhatsApp members list, and a five-minute
--    job sends it when they do.
--
-- 2. Once the introduction has landed, the family is asked every morning when
--    they would like their first class, until SYNC has a meeting for the group.

-- ---- 1. holding the introduction ------------------------------------------

-- AWAITING_MENTOR_JOIN -> a mentor is assigned and has been sent the invite,
-- but is not in the group yet, so the introduction has not been sent. The
-- mentor nudge runs over IN_PROGRESS/ABANDONED and so leaves these alone: the
-- mentor question is already answered, it is the joining that is outstanding.
alter table public.group_cases drop constraint if exists group_cases_stage_check;
alter table public.group_cases add  constraint group_cases_stage_check
  check (stage in ('AWAITING_JOIN', 'NEW', 'IN_PROGRESS', 'AWAITING_MENTOR_JOIN',
                   'MENTOR_ASSIGNED', 'ABANDONED'));

-- The assignment, parked until it can be delivered. Kept separate from
-- mentor_name so that column keeps meaning "the mentor this group was actually
-- introduced to" and nothing downstream starts reading a mentor who may still
-- never join.
alter table public.group_cases add column if not exists pending_mentor_name    text;
alter table public.group_cases add column if not exists pending_mentor_variant text;
-- When the wait started, so a stalled introduction is visible in the dashboard.
alter table public.group_cases add column if not exists pending_mentor_since   timestamptz;
-- Stamped the first time the mentor is seen in the group's member list.
alter table public.group_cases add column if not exists mentor_joined_at       timestamptz;

-- The five-minute job's working set: everything still waiting on a mentor.
create index if not exists group_cases_pending_mentor_idx
  on public.group_cases (pending_mentor_since) where pending_mentor_name is not null;

-- ---- 2. chasing the first class -------------------------------------------

-- Set once a meeting for this group is found on SYNC, which is what takes the
-- case out of the chase for good. The reason is kept so a group that stopped
-- being asked can be explained without re-querying SYNC.
alter table public.group_cases add column if not exists first_class_confirmed_at     timestamptz;
alter table public.group_cases add column if not exists first_class_confirmed_reason text;

-- The chase's own bookkeeping: when it started (for the Slack escalation),
-- when it last asked (so a redeploy cannot ask twice in a morning), and how
-- many times, which is what the dashboard shows.
alter table public.group_cases add column if not exists first_class_first_prompted_at timestamptz;
alter table public.group_cases add column if not exists first_class_prompted_at       timestamptz;
alter table public.group_cases add column if not exists first_class_prompt_count      integer not null default 0;
-- Stamped when Slack has been told this group is not booking, so it is told once.
alter table public.group_cases add column if not exists first_class_escalated_at      timestamptz;

-- The daily job's working set: introduced, no meeting found yet.
create index if not exists group_cases_first_class_pending_idx
  on public.group_cases (first_class_prompted_at)
  where first_class_confirmed_at is null;
