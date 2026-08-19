import bcrypt from "bcryptjs"

import { getPool } from "./db"
import type { Role, SessionUser } from "./types"

/**
 * The authentication seam. All credential checking lives here and runs on the
 * Node runtime only (bcrypt cannot run on the Edge).
 *
 * Credentials are validated against `public.dashboard_users` and nowhere else.
 * There are deliberately no built-in accounts: a fallback that let someone sign
 * in when DATABASE_URL was merely missing would turn one misconfigured deploy
 * into an open door, and a misconfigured deploy is exactly when nobody is
 * looking. Missing configuration fails closed instead.
 */

export const BCRYPT_COST = 12

/** A valid bcrypt hash used for a decoy comparison on unknown emails so that
 *  response timing doesn't reveal whether an account exists. */
const DECOY_HASH = "$2a$12$C6UzMDM.H6dfI/f/IKcEeO3jQ4pM0aQ5r9wF1lVQ2pQ0Zp1qk2wKO"

interface UserRow extends SessionUser {
  password_hash: string
  is_active: boolean
}

// ---------------------------------------------------------------------------

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function findUserRow(email: string): Promise<UserRow | null> {
  const normalized = email.trim().toLowerCase()
  const pool = getPool()

  if (!pool) {
    // No database configured: nobody can sign in. Loud, because a silent
    // "no such user" here looks identical to a wrong password.
    throw new Error(
      "DATABASE_URL is not set — the dashboard cannot verify credentials.",
    )
  }

  // Never select password_hash into anything that leaves the server layer —
  // it is read here purely for the bcrypt comparison below.
  const { rows } = await pool.query(
    `select id, email, name, role, password_hash, is_active
       from public.dashboard_users
      where email = $1
      limit 1`,
    [normalized],
  )
  if (rows.length === 0) return null
  const r = rows[0]
  return {
    id: r.id,
    email: r.email,
    name: r.name,
    role: r.role as Role,
    password_hash: r.password_hash,
    is_active: r.is_active,
  }
}

/**
 * Validate an email/password pair. Returns the safe {@link SessionUser} (never
 * the hash) on success, or `null` for any failure — wrong email, wrong
 * password, or an inactive account — so the caller can surface one generic
 * message. Failures take a constant ~200ms so timing doesn't leak whether the
 * email existed.
 */
export async function verifyCredentials(
  email: string,
  password: string,
): Promise<SessionUser | null> {
  const row = await findUserRow(email)

  if (!row) {
    // Decoy comparison keeps CPU work comparable to the real path.
    await bcrypt.compare(password, DECOY_HASH)
    await sleep(200)
    return null
  }

  const passwordOk = await bcrypt.compare(password, row.password_hash)
  if (!passwordOk || !row.is_active) {
    await sleep(200)
    return null
  }

  return { id: row.id, email: row.email, name: row.name, role: row.role }
}

/** Record a successful sign-in. */
export async function recordLogin(userId: string): Promise<void> {
  const pool = getPool()
  if (!pool) return
  await pool.query(
    `update public.dashboard_users set last_login_at = now() where id = $1`,
    [userId],
  )
}

/** Hash a plaintext password for the seed script. */
export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, BCRYPT_COST)
}

/** Whether credentials can be checked at all. False means DATABASE_URL is unset. */
export function isConfigured(): boolean {
  return Boolean(getPool())
}
