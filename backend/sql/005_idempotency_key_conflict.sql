-- ON CONFLICT cannot infer a partial index.
--
-- 003 created case_actions_idempotency_key_uniq with a WHERE clause. Postgres
-- only resolves ON CONFLICT (idempotency_key) against a partial index when the
-- statement itself carries a WHERE clause implying that predicate, and
-- PostgREST's on_conflict= parameter has no way to send one. So every claim
-- carrying an idempotency key failed with 42P10, "there is no unique or
-- exclusion constraint matching the ON CONFLICT specification" -- meaning no
-- dashboard action could be claimed at all.
--
-- The predicate was never doing any work. A plain unique index already lets any
-- number of rows hold a NULL key, because NULLs are distinct from one another
-- in a btree index -- the same reason the slack_ts index in 003 is safe. The
-- rows without a key still don't collide, and the ones with a key now have a
-- constraint ON CONFLICT can actually see.
--
-- Dropping and recreating cannot fail on existing data: the partial index was
-- already enforcing uniqueness over exactly the non-null keys.

drop index if exists public.case_actions_idempotency_key_uniq;

create unique index if not exists case_actions_idempotency_key_uniq
  on public.case_actions (idempotency_key);
