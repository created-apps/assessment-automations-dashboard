-- Assessment completions.
--
-- One row per (case, assessment) that has been detected as completed -- the
-- student's email showed up in that assessment's Google Form response sheet --
-- and announced in Slack. The primary key makes the announcement fire exactly
-- once. Run once in the Supabase SQL editor.

create table if not exists public.assessment_completions (
  case_id uuid not null references public.group_cases (id) on delete cascade,
  kind text not null
    check (kind in ('CS_ASSESSMENT', 'PROTOTYPING_ASSESSMENT')),
  -- The email that matched in the response sheet, for the audit trail.
  student_email text,
  completed_at timestamptz not null default now(),
  primary key (case_id, kind)
);

-- Same lockdown as the sibling tables: RLS on, no policies, service key only.
alter table public.assessment_completions enable row level security;
revoke all on public.assessment_completions from anon, authenticated;
