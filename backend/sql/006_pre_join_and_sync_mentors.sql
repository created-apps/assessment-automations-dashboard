-- Pre-join cases, and mentors that exist on SYNC as well as here.
--
-- Two independent changes, one migration because both land at the same time.
-- Run once in the Supabase SQL editor, like the others.
--
-- 1. A case used to be created only at handover -- after the family had joined
--    and the welcome had gone out -- because it needed a Slack thread to hang
--    replies on. The dashboard now shows a project as soon as its WhatsApp
--    group exists, so the case is written at group creation and the Slack
--    thread is attached later, at handover. That makes the two Slack columns
--    nullable and adds the stage a case sits in until then.
--
-- 2. Mentors are identified by a SYNC user id rather than by matching their
--    name, which only ever worked for the names that happened to align.

-- ---- 1. pre-join cases ----------------------------------------------------

alter table public.group_cases alter column slack_channel   drop not null;
alter table public.group_cases alter column slack_thread_ts drop not null;

-- AWAITING_JOIN -> group exists, family hasn't joined, no Slack thread yet.
-- Nothing nudges it (the nudge runs over IN_PROGRESS/ABANDONED only) and
-- nothing reads a thread from it until handover moves it to NEW.
alter table public.group_cases drop constraint if exists group_cases_stage_check;
alter table public.group_cases add  constraint group_cases_stage_check
  check (stage in ('AWAITING_JOIN', 'NEW', 'IN_PROGRESS', 'MENTOR_ASSIGNED', 'ABANDONED'));

-- ---- 2. mentor identity ---------------------------------------------------

-- The mentor's SYNC users.id, resolved when they are added from the dashboard.
-- Null means the SYNC account could not be created yet; sync_error says why and
-- the backfill retries it.
alter table public.mentors add column if not exists sync_user_id text;
alter table public.mentors add column if not exists sync_error   text;

create unique index if not exists mentors_sync_user_id_idx
  on public.mentors (sync_user_id) where sync_user_id is not null;

-- Rows still waiting for their SYNC account -- the backfill's working set.
create index if not exists mentors_sync_pending_idx
  on public.mentors (created_at) where sync_user_id is null;

-- Stamped when the mentor is introduced, so every downstream step (the SYNC
-- membership, the mentor's Drive access, the COSMIC mentor match) resolves by
-- id instead of re-matching mentor_name against SYNC's spelling.
alter table public.group_cases add column if not exists mentor_sync_user_id text;
