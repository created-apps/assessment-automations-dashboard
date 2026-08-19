-- Dashboard-added mentors.
--
-- The mentor directory started as a static file (src/data/mentors.json). This
-- table holds mentors added from the dashboard; the backend merges the two
-- (a row here overrides a seed entry with the same name), so the picker and the
-- name matcher pick new mentors up without a redeploy. Run once in the Supabase
-- SQL editor.

create table if not exists public.mentors (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  -- The WhatsApp introduction sent verbatim when this mentor is introduced.
  intro      text not null,
  -- Optional subject-specific intros: { "chemistry": "…", "biology": "…" }.
  variants   jsonb,
  email      text,
  phone      text,
  -- The dashboard user who added them, for the audit trail.
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- One mentor per name. Case-insensitive so "Aash Shah" can't be added twice.
create unique index if not exists mentors_name_lower_idx
  on public.mentors (lower(name));

-- Same lockdown as the sibling tables: RLS on, no policies, service key only.
alter table public.mentors enable row level security;
revoke all on public.mentors from anon, authenticated;
