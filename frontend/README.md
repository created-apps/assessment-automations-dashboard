# CreatED Operations Dashboard

Internal, invite-only tool for tracking student groups, sending WhatsApp
actions, and assigning mentors. There is **no public sign-up** — accounts are
created only by an admin.

## Authentication model

- **Email + password only.** Custom implementation using `jose` (JWT session in
  an httpOnly, `SameSite=Lax`, `Secure`-in-prod cookie) and `bcryptjs` (cost 12)
  for password hashing. No Better Auth, no OAuth, no magic links.
- **Two roles.**
  - `admin` — full access; can send assessments, booking links, and mentor intros.
  - `viewer` — read-only; action buttons are disabled and the send endpoint
    returns `403` even if called directly.
- **Route protection** lives in `middleware.ts` (Edge runtime, verifies the JWT
  with `jose`). Unauthenticated requests are redirected to `/login?next=…`;
  an authenticated user hitting `/login` is bounced to `/`.
- **Server-side enforcement.** `/api/actions/send` re-checks the session and
  role on every action. Disabled buttons are a convenience, not the boundary.
- **Attribution.** Each recorded action is stamped with the session user's name
  (visible in the activity timeline as "by <name>").

## Running without a database (default)

If `DATABASE_URL` is **not** set, the app runs in **mock mode** with two seeded
accounts so roles can be demoed immediately:

| Role   | Email                | Password     |
| ------ | -------------------- | ------------ |
| Admin  | `admin@created.app`  | `admin1234`  |
| Viewer | `viewer@created.app` | `viewer1234` |

These mock accounts still store real bcrypt hashes and are verified with
`bcrypt.compare`, exactly like database accounts.

## Switching to Postgres

1. Set `DATABASE_URL` (any Postgres — Neon is the project default) and
   `AUTH_SECRET` (a long random string, e.g. `openssl rand -base64 32`).
2. Create the users table:
   ```bash
   psql "$DATABASE_URL" -f scripts/001-create-users.sql
   ```
3. Invite accounts (this is the only way users are created):
   ```bash
   pnpm invite:user -- --email jane@created.app --name "Jane Doe" --role admin
   # prints a one-time generated password, or pass --password "…"
   ```

Once `DATABASE_URL` is present the app automatically validates credentials
against `public.dashboard_users` instead of the mock accounts — no code change.

## Environment variables

| Variable       | Required | Purpose                                                        |
| -------------- | -------- | -------------------------------------------------------------- |
| `AUTH_SECRET`  | prod     | Signs/verifies the session JWT. A dev fallback is used if unset. |
| `DATABASE_URL` | prod     | Postgres connection string. If unset, mock mode is used.       |
