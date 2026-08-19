import { SignJWT, jwtVerify } from "jose"
import type { SessionPayload } from "./types"

/**
 * Session utilities built on `jose`. This module is intentionally free of any
 * Node-only dependencies (bcrypt, pg) so it can run on the Edge runtime inside
 * middleware as well as in Node route handlers.
 */

export const SESSION_COOKIE = "created_session"
export const SESSION_MAX_AGE = 60 * 60 * 24 * 7 // 7 days, in seconds

/**
 * Fails closed when AUTH_SECRET is missing.
 *
 * There is deliberately no fallback key. A built-in default would be published
 * in this repository, so anyone could mint a valid admin session against any
 * deployment that forgot to set the variable — and forgetting is exactly the
 * moment nobody is watching. Refusing to sign is the safe failure.
 */
function getSecret(): Uint8Array {
  const secret = process.env.AUTH_SECRET
  if (!secret) {
    throw new Error(
      "AUTH_SECRET is not set — sessions cannot be signed or verified.",
    )
  }
  return new TextEncoder().encode(secret)
}

/** Sign a session JWT valid for {@link SESSION_MAX_AGE} seconds. */
export async function signSession(payload: SessionPayload): Promise<string> {
  return new SignJWT({ ...payload })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(payload.sub)
    .setIssuedAt()
    .setExpirationTime(`${SESSION_MAX_AGE}s`)
    .sign(getSecret())
}

/** Verify a session JWT, returning the payload or `null` when invalid/expired. */
export async function verifySession(
  token: string | undefined | null,
): Promise<SessionPayload | null> {
  if (!token) return null
  try {
    const { payload } = await jwtVerify(token, getSecret(), {
      algorithms: ["HS256"],
    })
    if (
      typeof payload.sub === "string" &&
      typeof payload.email === "string" &&
      typeof payload.name === "string" &&
      (payload.role === "admin" || payload.role === "viewer")
    ) {
      return {
        sub: payload.sub,
        email: payload.email,
        name: payload.name,
        role: payload.role,
      }
    }
    return null
  } catch {
    return null
  }
}
