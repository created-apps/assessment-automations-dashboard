-- Cursor for the reply poller.
--
-- Slack message timestamps are ordered, so the newest one already examined in
-- a thread is all the state polling needs: the next run asks Slack only for
-- messages after it. Without this every run would re-read the whole thread --
-- harmless for commands, which are deduped by case_actions.slack_ts, but a
-- reply the parser rejects would draw a fresh complaint into the thread on
-- every single tick.
--
-- Null means the thread has never been polled; the first run then reads it
-- from the top and catches anything said before polling was switched on.

alter table public.group_cases
  add column if not exists last_reply_ts text;
