import { cookies } from "next/headers"

import { SESSION_COOKIE, verifySession } from "./session"
import type { SessionUser } from "./types"

/**
 * Read and verify the session from the request cookies. Safe to call from
 * Server Components, Route Handlers, and Server Actions. Returns `null` when
 * there is no valid session.
 */
export async function getCurrentUser(): Promise<SessionUser | null> {
  const store = await cookies()
  const token = store.get(SESSION_COOKIE)?.value
  const payload = await verifySession(token)
  if (!payload) return null
  return {
    id: payload.sub,
    email: payload.email,
    name: payload.name,
    role: payload.role,
  }
}
