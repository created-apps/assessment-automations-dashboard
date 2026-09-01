import { NextResponse } from "next/server"
import { z } from "zod"

import { updateMentorIntro } from "@/lib/backend"
import { backendFailure, requireAdmin } from "@/lib/route-helpers"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const bodySchema = z.object({
  intro: z.string().trim().min(1).max(8000),
})

/**
 * Edit a mentor's introduction. Admin-only, like adding one — it changes what
 * the whole team sends. The editor is taken from the session for the audit
 * trail on mentors that gain their first row through this edit.
 */
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ name: string }> },
) {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.response

  const { name } = await params

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
    const mentor = await updateMentorIntro(name, {
      intro: parsed.data.intro,
      actor: auth.user.name,
    })
    return NextResponse.json(mentor)
  } catch (err) {
    return backendFailure(err)
  }
}
