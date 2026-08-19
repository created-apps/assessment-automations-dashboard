-- Actions are triggered from the dashboard rather than from Slack.
--
-- Three consequences for case_actions:
--
--   * slack_ts no longer exists for most rows, so it has to become nullable.
--     Its unique index stays -- Postgres allows many NULLs in a unique index,
--     so the old Slack rows keep their guarantee and new rows are unaffected.
--
--   * idempotency_key replaces it as the thing that stops one instruction being
--     carried out twice. The dashboard generates one per confirmed dialog, so a
--     network retry or a double-click re-sends the same key and the insert is
--     ignored rather than sending a second WhatsApp message.
--
--   * actor records which signed-in team member triggered it. These messages go
--     to families, so every one has to be traceable to a person.

alter table public.case_actions
  alter column slack_ts drop not null;

alter table public.case_actions
  add column if not exists actor text,
  add column if not exists idempotency_key text;

-- Partial, so the many rows without a key don't collide with each other.
-- Superseded by 005: a partial index is invisible to ON CONFLICT, and the
-- predicate was never needed to keep the keyless rows apart.
create unique index if not exists case_actions_idempotency_key_uniq
  on public.case_actions (idempotency_key)
  where idempotency_key is not null;

-- The dashboard lists actions per case, newest first.
create index if not exists case_actions_case_created_idx
  on public.case_actions (case_id, created_at desc);
