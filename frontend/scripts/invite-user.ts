/**
 * Invite-only account creation. This is the ONLY way a user comes to exist —
 * there is no public sign-up. Run against a database (requires DATABASE_URL):
 *
 *   pnpm invite:user -- --email jane@created.app --name "Jane Doe" --role admin --password "s3cret!!"
 *
 * If --password is omitted, a strong one is generated and printed once. Re-running
 * for an existing email updates that user's name/role/password (a password reset).
 */
import { randomBytes } from "node:crypto"

import { getPool } from "../lib/db"
import { hashPassword } from "../lib/auth"

type Role = "admin" | "viewer"

function parseArgs(argv: string[]) {
  const args: Record<string, string> = {}
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i]
    if (token.startsWith("--")) {
      const key = token.slice(2)
      const value = argv[i + 1]?.startsWith("--") ? "" : argv[++i]
      args[key] = value ?? ""
    }
  }
  return args
}

function generatePassword(): string {
  // 18 url-safe chars — printed once, never stored in plaintext.
  return randomBytes(18).toString("base64url")
}

async function main() {
  const pool = getPool()
  if (!pool) {
    console.error(
      "DATABASE_URL is not set. Seeding requires a database. In dev without a\n" +
        "database, the app already exposes two mock accounts (see README).",
    )
    process.exit(1)
  }

  const args = parseArgs(process.argv.slice(2))
  const email = args.email?.trim().toLowerCase()
  const name = args.name?.trim()
  const role = (args.role?.trim() as Role) || "viewer"

  if (!email || !name) {
    console.error('Usage: pnpm invite:user -- --email <e> --name "<n>" [--role admin|viewer] [--password <p>]')
    process.exit(1)
  }
  if (role !== "admin" && role !== "viewer") {
    console.error(`Invalid role "${role}". Must be "admin" or "viewer".`)
    process.exit(1)
  }

  const password = args.password || generatePassword()
  const generated = !args.password
  const passwordHash = await hashPassword(password)

  await pool.query(
    `insert into public.dashboard_users (email, name, role, password_hash, is_active)
       values ($1, $2, $3, $4, true)
     on conflict (email) do update
       set name = excluded.name,
           role = excluded.role,
           password_hash = excluded.password_hash,
           is_active = true`,
    [email, name, role, passwordHash],
  )

  console.log(`\n  Invited ${name} <${email}> as ${role}.`)
  if (generated) {
    console.log(`  Temporary password (shown once): ${password}\n`)
  } else {
    console.log("  Password set from --password flag.\n")
  }

  await pool.end()
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
