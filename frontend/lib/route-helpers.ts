import { NextResponse } from "next/server"

import { getCurrentUser } from "./current-user"
import { BackendError } from "./backend"
import type { SessionUser } from "./types"

/**
 * Shared guards for the dashboard's own API routes.
 *
 * Every route under /api/cases and /api/mentors proxies the automations
 * backend. The browser never holds the backend token, so these handlers are
 * the boundary: they establish who is asking, and only then call through.
 */

export async function requireUser(): Promise<
  { ok: true; user: SessionUser } | { ok: false; response: NextResponse }
> {
  const user = await getCurrentUser()
  if (!user) {
    return {
      ok: false,
      response: NextResponse.json({ error: "You are not signed in." }, { status: 401 }),
    }
  }
  return { ok: true, user }
}

/**
 * Sending is admin-only. Disabling buttons for viewers is a convenience; this
 * is the enforcement, so a viewer POSTing directly still gets 403.
 */
export async function requireAdmin(): Promise<
  { ok: true; user: SessionUser } | { ok: false; response: NextResponse }
> {
  const auth = await requireUser()
  if (!auth.ok) return auth
  if (auth.user.role !== "admin") {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Read-only access — ask an admin to send this" },
        { status: 403 },
      ),
    }
  }
  return auth
}

/** Turn a backend failure into a response, without leaking its internals. */
export function backendFailure(err: unknown): NextResponse {
  if (err instanceof BackendError) {
    // 422 carries the mentor suggestions the dialog shows, so pass it through.
    return NextResponse.json(
      { error: err.message, ...err.details },
      { status: err.status },
    )
  }
  console.error("route error:", err)
  return NextResponse.json({ error: "Something went wrong." }, { status: 500 })
}
