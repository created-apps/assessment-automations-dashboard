import { Pool } from "pg"

/**
 * Lazily-created Postgres pool. Node runtime only — never import this from
 * middleware (Edge). Returns `null` when DATABASE_URL is absent, which is the
 * signal for the auth layer to fall back to mock accounts (see lib/auth.ts).
 */

let pool: Pool | null = null

export function hasDatabase(): boolean {
  return Boolean(process.env.DATABASE_URL)
}

export function getPool(): Pool | null {
  if (!hasDatabase()) return null
  if (!pool) {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      // Managed Postgres (Neon, Supabase, RDS, …) require TLS. `no-verify`
      // keeps setup friction low for an internal tool; tighten if needed.
      ssl: { rejectUnauthorized: false },
      max: 5,
    })
  }
  return pool
}
