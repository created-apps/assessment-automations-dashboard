import { NextResponse } from "next/server"
import { z } from "zod"

import { changeCasePhone } from "@/lib/backend"
import { backendFailure, requireAdmin } from "@/lib/route-helpers"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const bodySchema = z.object({
  role: z.enum(["student", "parent"]),
  // Digits are counted on the backend, which owns the stored format. Here it
  // only has to be plausibly a number before the call is worth making.
  phone: z.string().trim().min(8).max(24),
})

/**
 * PATCH /api/cases/:id/phone
 *
 * Change the number the automations use for the student or the parent. Admin
 * only: it decides which number the group-creation service waits on to join,
 * and which number every later message is addressed to — a viewer correcting
 * a digit wrong could leave a family's follow-up pointed at a stranger.
 *
 * The actor is taken from the session, never the body.
 */
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.response

  const { id } = await params

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
        error: "Give the number in full, with its country code.",
        issues: parsed.error.issues.map((i) => ({
          path: i.path.join("."),
          message: i.message,
        })),
      },
      { status: 400 },
    )
  }

  try {
    return NextResponse.json(
      await changeCasePhone(id, { ...parsed.data, actor: auth.user.name }),
    )
  } catch (err) {
    return backendFailure(err)
  }
}
