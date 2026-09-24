-- Remembering that we have already complained about a sheet row's mentor.
--
-- The sheet sync runs hourly. When a row names a mentor the directory cannot
-- resolve, it now says so in the group's Slack thread -- and without this it
-- would say so again every hour, for as long as the row stays wrong, which is
-- how a useful alert becomes one nobody reads.
--
-- The key is what was actually unresolvable (the row's mentor name and email,
-- normalised), not a plain "already warned" flag. That distinction is the
-- whole point:
--
--   * the same bad value on the next pass is the same complaint -- stay quiet;
--   * a DIFFERENT bad value means somebody edited the row and got it wrong
--     again, which is worth saying;
--   * a value that resolves clears the key, so if the row later breaks again
--     it is reported afresh.
--
-- Run once in the Supabase SQL editor.

alter table public.group_cases
  add column if not exists mentor_alert_key text,
  add column if not exists mentor_alert_at timestamptz;
