# assessment-automations

Dashboard-driven follow-up for the WhatsApp groups created by the `Automations`
(Periskope) service.

When a group is created, that service posts it here. This one records the group
and exposes it to the operations dashboard, where the team decides what to send:
a mentor introduction, one of the two learning assessments, or a booking link.
Each of those becomes a WhatsApp message in the group. Until a mentor is
assigned, a daily nudge goes to Slack.

Slack is a notification channel only — this service posts to it and never reads
from it. All instructions come from the dashboard over `/api`.

## The flow

```
Automations                 assessment-automations              Dashboard / WhatsApp
-----------                 ----------------------              --------------------
sheet row -> WhatsApp group
  |
  |-- POST /group-registered -> stores a GroupCase at
  |     (group exists, no one         AWAITING_JOIN, no Slack thread yet:
  |      has joined yet)              the project is already on the dashboard
  |
  '-- POST /group-created -> opens the thread on that case -->  Slack: "new group" notice
        (family joined,         (or creates it, for a group made
         welcome sent)           outside intake)
                                    |
                            GET /api/cases/summaries  <-------  the team opens the dashboard
                            POST /api/cases/:id/actions <-----  they confirm an action
                                    |
                                    '-- sends the message ---->  WhatsApp group
                                    '-- records the action --->  case_actions (with actor)

daily cron ---------------> cases with no mentor yet -------->  Slack nudge, linking to
                                                                the group in the dashboard
```

## The four actions

Taken in the dashboard, one confirmed dialog each. Every one sends a real
WhatsApp message into the group and is recorded in `case_actions` against the
signed-in user who triggered it.

| Action | What happens |
| --- | --- |
| Add mentor | Sends that mentor's introduction into the group. Completes the case — it stops being nudged. |
| Computer Science assessment | Sends the CS assessment message, addressed to the student, with the chosen deadline. |
| Prototyping assessment | Sends the prototyping assessment message. |
| Schedule a meeting | Sends the chosen person's booking link. |

Details:

- **Mentor names are matched, not looked up.** The dashboard picks from the
  directory so the name is usually exact, but the matcher still runs: it accepts
  "Harshit Sir" or a misspelling, and refuses to guess when a name is ambiguous
  ("Singh" matches two mentors) — that comes back as a 422 with suggestions
  rather than sending the wrong mentor's introduction to a parent.

- **Deadlines** arrive as ISO dates and are rendered for families as
  "25 May 2026".

- **Every action is carried out once.** The dashboard sends an
  `idempotency_key` per confirmed dialog; a retry or double-click replays the
  first result instead of sending a second message.

## Slack

Outbound only. The service posts a thread when a group is created and a daily
nudge until a mentor is assigned, each deep-linking to the group in the
dashboard. It never reads Slack — there is no event endpoint, no reply polling,
no signing secret, and the bot needs only `chat:write`.

## The mentor directory

`src/data/mentors.json` — 53 mentors, extracted from *Mentor Descriptions.pdf*.
Each entry is `{ name, intro }`, plus `variants` for the two mentors with more
than one written introduction. The introduction is sent to the group exactly as
written. To add or correct one, edit the JSON; nothing else needs to change.

Mentors added from the dashboard live in the `mentors` table instead and are
merged on top of that seed. Adding one does two things (`src/mentor-sync.ts`):

1. writes the row here, and
2. gives them a **SYNC `users` row with role `mentor`**, storing its id as
   `mentors.sync_user_id`.

Phone is therefore **required**: SYNC's `users.phone_number` is NOT NULL and is
what an account is keyed on, and it is also where the group invite is DM'd. A
number already on SYNC under another role is promoted to mentor rather than
duplicated. If SYNC is unreachable the mentor is still saved, the error is kept
on the row, and the `mentor sync backfill` cron retries it — SYNC being down is
not a reason the team can't add a mentor.

When a mentor is introduced, that SYNC id is stamped onto the case
(`group_cases.mentor_sync_user_id`), so every downstream step resolves the
mentor by id instead of matching their name against SYNC's spelling of it.

## The intake sheet as a second editor

The project title and description can be edited in the dashboard **or** typed
straight into the intake sheet. The dashboard direction mirrors into the row on
submit; `src/sheet-sync.ts` is the cron that reads the other way.

Two writers to one field needs a rule, and "whichever is newer" isn't one —
there is no shared clock, and the dashboard's own mirror-write lands in the
sheet looking like a fresh edit. So `project_setups.sheet_details_seen` holds
what the sheet last said, and "the sheet was edited" means `sheet != seen`.
Both writers keep it current, so the mirror-write can't bounce back. It is only
ever written **after** a sheet write actually lands: skipping it on failure is
what stops stale text being read back over new details.

A row with both a Project Name and a Project Description sets `submitted_at`,
which is what makes the case eligible for the project-setup service. The
curriculum subject has no sheet column and stays dashboard-only.

## Setup

### 1. Slack app

Create an app at <https://api.slack.com/apps>, then:

- **OAuth & Permissions** → Bot Token Scopes: **`chat:write` only**. Install the
  app and copy the `xoxb-` token into `SLACK_BOT_TOKEN`.
- Invite the bot to the channel, and put that channel's id (`C0123ABCD`, not the
  name) in `SLACK_CHANNEL_ID`.

That's the whole Slack setup. **No Event Subscriptions, no public URL, no
tunnel, no signing secret, no `channels:history`** — the service only ever posts.

### 2. Environment

Copy `.env.example` to `.env` and fill it in.

- `INTAKE_SHARED_SECRET` must match `ASSESSMENT_WEBHOOK_SECRET` in `Automations`.
- `DASHBOARD_API_SECRET` must match `BACKEND_API_SECRET` in the frontend.
- `DASHBOARD_URL` is the dashboard's public URL, used to deep-link Slack nudges
  to the right group.

### 3. Database

No new database, and no ORM. The two tables this service needs live in the same
Supabase project `Automations` already uses, in `public`, and are reached over
the REST API with the service key — exactly how `Automations` reaches `users`
and `groups`.

Create them once. Supabase → **SQL Editor** → run the files in `sql/` in order:
[`001_init.sql`](sql/001_init.sql), [`002_reply_cursor.sql`](sql/002_reply_cursor.sql),
[`003_dashboard_actions.sql`](sql/003_dashboard_actions.sql),
[`004_mentors.sql`](sql/004_mentors.sql), then
[`005_idempotency_key_conflict.sql`](sql/005_idempotency_key_conflict.sql). All
are idempotent, so re-running is safe.

Then set the same two values `Automations` uses:

```
SUPABASE_URL=https://<project-ref>.supabase.co
SUPABASE_SERVICE_KEY=<service-role key>
```

Both are under **Project Settings → API**. The service-role key bypasses row
level security, which is what lets this service read its tables at all.

```bash
npm install
```

> The SQL turns RLS **on** for both tables and defines no policies. That's
> deliberate: `group_cases` holds student and parent contact details, it sits in
> `public` where Supabase exposes it over PostgREST, and RLS-on-with-no-policy
> means the anon key gets nothing while the service key still works. Don't add a
> permissive policy to "fix" a 401 — check the key instead.

To change the schema later, write the SQL and run it; there is no migration
tool to keep in step. `src/db.ts` is the only file that knows the column names.

> **One thing to know about sharing the database.** `Automations` manages that
> same database with Prisma, and these two tables aren't in its schema file, so
> Prisma sees them as drift. `prisma migrate deploy` — what its `railway.toml`
> runs — doesn't care and will not touch them. But `prisma migrate dev` does
> care, and offers to reset the database to resolve the drift. Never point
> `migrate dev` at the shared project; use it against a local database only.
> That's the normal rule for a dev-only command, it just now has teeth.

### 4. Run

```bash
npm run dev
```

## Deployment

`railway.toml` builds and starts the service — no migration step, since the
tables are created by hand once. **`numReplicas` must stay at 1**: the nudge
cron ticks inside every replica, so a second one posts a duplicate reminder into
every open thread each day.

## Endpoints

| Method | Path | Auth |
| --- | --- | --- |
| `GET` | `/health` | none — reports 503 when storage is unreachable |
| `POST` | `/group-registered` | `Authorization: Bearer $INTAKE_SHARED_SECRET` — pre-join, no Slack thread |
| `POST` | `/group-created` | ditto — the handover; opens the Slack thread |
| `GET` | `/api/cases` | `Authorization: Bearer $DASHBOARD_API_SECRET` |
| `GET` | `/api/cases/summaries` | ditto — list view, with each group's last action |
| `GET` | `/api/cases/:id` | ditto |
| `GET` | `/api/cases/:id/actions` | ditto — the timeline |
| `GET` | `/api/mentors` | ditto — the directory |
| `POST` | `/api/mentors` | ditto — adds a mentor, here and on SYNC |
| `GET` | `/api/hosts` | ditto — booking names only, URLs stay server-side |
| `POST` | `/api/cases/:id/actions` | ditto — carries out one action |

The `/api/*` responses are snake_case and mirror the dashboard's
`lib/types.ts`, so its data layer swaps from mock data to `fetch` with no
reshaping. Only the dashboard's **server** calls these — the token and the
family contact details never reach a browser.

`POST /api/cases/:id/actions` takes one of:

```json
{ "kind": "ADD_MENTOR", "mentor": "Omm Barik", "variant": "chemistry" }
{ "kind": "CS_ASSESSMENT", "deadline": "2026-05-25" }
{ "kind": "PROTOTYPING_ASSESSMENT", "deadline": "2026-05-25" }
{ "kind": "SCHEDULE_MEETING", "host": "Urja Jhaveri" }
```

plus optional `actor` (the signed-in user) and `idempotency_key`. It returns
`{ case, action, replayed }`. A name that matches no mentor, or two equally
well, comes back as **422** with `suggestions` — nothing is sent.

`POST /group-created` is idempotent on `chat_id`: a replay refreshes the stored
details and returns the existing case rather than opening a second thread.

```json
{
  "chat_id": "9199...@g.us",
  "group_name": "CreatED X Asha: Robotics",
  "student_name": "Asha",
  "student_phone": "919876543210",
  "parent_name": "Parent of Asha",
  "project_name": "Robotics",
  "source": "google-sheet",
  "sheet_row": 42
}
```

## Operations

```bash
npm run nudge                  # run the daily mentor chase by hand
npm run mentors                # list the directory
npm run mentors -- "<name>"    # check what a typed name resolves to
npm run typecheck
```

A case's whole history is in `case_actions`: the reply verbatim, who sent it,
what it resolved to, and whether it succeeded.

### Tuning the name matching

`MENTOR_MIN_MATCH_SCORE` (default `0.72`) is the floor for accepting a name, and
`MENTOR_AMBIGUITY_MARGIN` (default `0.05`) is how close the runner-up has to be
before the match is treated as ambiguous. Raise the floor if a wrong mentor is
ever matched; lower it if correct names are being turned away. `npm run mentors
-- "<name>"` prints the scores, so tune against real examples.
