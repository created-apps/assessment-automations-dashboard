-- The per-case kill switch.
--
-- One column on the case is the whole mechanism: every automation that touches
-- a group -- the mentor nudge, the action queue, the mentor-join check, the
-- first-class chase, the assessment-completion announcements, the sheet sync,
-- the Stage 5 project-setup cron in the other service, and the join/welcome
-- check in the group-creation service -- filters on it being NULL. Setting it
-- stops all of them for that case, and only that case; nothing else has to
-- know the switch exists.
--
-- It is deliberately NOT a stage. A stage says where a case has got to and is
-- written by the automations themselves as they work; this says a person told
-- us to stop, and nothing may overwrite it. A case keeps whatever stage it had
-- when it was stopped, so the record of where it got to survives.
--
-- Run once in the Supabase SQL editor.

alter table public.group_cases
  add column if not exists operations_stopped_at timestamptz,
  -- The signed-in dashboard user who pressed it. These messages go to
  -- families; so does the decision to stop sending them.
  add column if not exists operations_stopped_by text,
  add column if not exists operations_stopped_reason text;

-- Every job's working-set query now carries `operations_stopped_at is null`,
-- and the stopped set is expected to stay small, so the index covers exactly
-- the rows those queries keep.
create index if not exists group_cases_live_idx
  on public.group_cases (created_at)
  where operations_stopped_at is null;
