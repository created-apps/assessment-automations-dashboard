import { NextResponse } from "next/server"
import { z } from "zod"

import { recordLogin, verifyCredentials } from "@/lib/auth"
import { clearAttempts, isAllowed, registerFailure } from "@/lib/rate-limit"
import { SESSION_COOKIE, SESSION_MAX_AGE, signSession } from "@/lib/session"

// bcrypt + pg require the Node runtime; they cannot run on the Edge.
export const runtime = "nodejs"

const GENERIC_ERROR = "Those details don't match an account."
const RATE_LIMITED = "Too many attempts, try again shortly."

const bodySchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(1),
})

function clientIp(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for")
  if (fwd) return fwd.split(",")[0]!.trim()
  return req.headers.get("x-real-ip") ?? "unknown"
}

export async function POST(req: Request) {
  let json: unknown
  try {
    json = await req.json()
  } catch {
    return NextResponse.json({ error: GENERIC_ERROR }, { status: 400 })
  }

  const parsed = bodySchema.safeParse(json)
  if (!parsed.success) {
    // Never reveal which field was malformed — same generic message.
    return NextResponse.json({ error: GENERIC_ERROR }, { status: 400 })
  }

  const { email, password } = parsed.data
  const ip = clientIp(req)

  if (!isAllowed(ip, email)) {
    return NextResponse.json({ error: RATE_LIMITED }, { status: 429 })
  }

  const user = await verifyCredentials(email, password)
  if (!user) {
    registerFailure(ip, email)
    return NextResponse.json({ error: GENERIC_ERROR }, { status: 401 })
  }

  clearAttempts(ip, email)
  await recordLogin(user.id)

  const token = await signSession({
    sub: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
  })

  const res = NextResponse.json({ user })
  res.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_MAX_AGE,
  })
  return res
}
