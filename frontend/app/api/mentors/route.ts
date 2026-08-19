import { NextResponse } from "next/server"
import { z } from "zod"

import { createMentor, listMentors } from "@/lib/backend"
import { backendFailure, requireAdmin, requireUser } from "@/lib/route-helpers"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/** The mentor directory. Any signed-in user may read. */
export async function GET() {
  const auth = await requireUser()
  if (!auth.ok) return auth.response

  try {
    return NextResponse.json(await listMentors())
  } catch (err) {
    return backendFailure(err)
  }
}

const bodySchema = z.object({
  name: z.string().trim().min(1).max(200),
  intro: z.string().trim().min(1).max(8000),
  email: z.string().trim().email().max(320).optional(),
  phone: z.string().trim().min(3).max(40).optional(),
})

/**
 * Add a mentor to the directory. Admin-only — it changes what the whole team
 * can send. The creator is taken from the session for the audit trail.
 */
export async function POST(req: Request) {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.response

  let raw: unknown
  try {
    raw = await req.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 })
  }

  const parsed = bodySchema.safeParse(raw)
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: "Invalid request.",
        issues: parsed.error.issues.map((i) => ({
          path: i.path.join("."),
          message: i.message,
        })),
      },
      { status: 400 },
    )
  }

  try {
    const mentor = await createMentor({ ...parsed.data, actor: auth.user.name })
    return NextResponse.json(mentor, { status: 201 })
  } catch (err) {
    return backendFailure(err)
  }
}
