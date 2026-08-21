import { NextResponse } from "next/server"
import { z } from "zod"

import { listQueue, queueAction } from "@/lib/backend"
import { backendFailure, requireAdmin, requireUser } from "@/lib/route-helpers"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/** What is lined up for this case, in the order it will run. */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireUser()
  if (!auth.ok) return auth.response

  const { id } = await params
  try {
    return NextResponse.json(await listQueue(id))
  } catch (err) {
    return backendFailure(err)
  }
}

const bodySchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("ADD_MENTOR"),
    mentor: z.string().trim().min(1),
    variant: z.string().trim().min(1).optional(),
  }),
  z.object({
    kind: z.literal("CS_ASSESSMENT"),
    deadline_days: z.number().int().min(1).max(365),
  }),
  z.object({
    kind: z.literal("PROTOTYPING_ASSESSMENT"),
    deadline_days: z.number().int().min(1).max(365),
  }),
  z.object({
    kind: z.literal("SCHEDULE_MEETING"),
    host: z.string().trim().min(1),
  }),
])

/**
 * Add one action to the case's queue.
 *
 * Nothing is sent here, but everything queued will eventually send a real
 * message to a family, so this is admin-only on the same footing as sending
 * now. The actor comes from the session, never the body.
 */
export async function POST(
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
    const result = await queueAction(id, { ...parsed.data, actor: auth.user.name })
    return NextResponse.json(result, { status: 201 })
  } catch (err) {
    return backendFailure(err)
  }
}
