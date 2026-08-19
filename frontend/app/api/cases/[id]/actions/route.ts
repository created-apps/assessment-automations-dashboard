import { NextResponse } from "next/server"
import { z } from "zod"

import { getCaseActions, performAction, type ActionBody } from "@/lib/backend"
import { backendFailure, requireAdmin, requireUser } from "@/lib/route-helpers"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/** The timeline for one group. Any signed-in user may read it. */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireUser()
  if (!auth.ok) return auth.response

  const { id } = await params
  try {
    return NextResponse.json(await getCaseActions(id))
  } catch (err) {
    return backendFailure(err)
  }
}

const bodySchema = z.intersection(
  z.discriminatedUnion("kind", [
    z.object({
      kind: z.literal("ADD_MENTOR"),
      mentor: z.string().trim().min(1),
      variant: z.string().trim().min(1).optional(),
    }),
    z.object({
      kind: z.literal("CS_ASSESSMENT"),
      deadline: z.string().trim().min(1),
    }),
    z.object({
      kind: z.literal("PROTOTYPING_ASSESSMENT"),
      deadline: z.string().trim().min(1),
    }),
    z.object({
      kind: z.literal("SCHEDULE_MEETING"),
      host: z.string().trim().min(1),
    }),
  ]),
  z.object({ idempotency_key: z.string().trim().min(1).max(200).optional() }),
)

/**
 * Carry out one action — this is what actually sends a WhatsApp message to a
 * family, so it is admin-only and always attributed to the session user.
 *
 * The actor is taken from the session, never from the request body: a client
 * must not be able to send a message under someone else's name.
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

  const { idempotency_key: idempotencyKey, ...action } = parsed.data

  try {
    const result = await performAction(id, {
      ...(action as ActionBody),
      actor: auth.user.name,
      ...(idempotencyKey ? { idempotency_key: idempotencyKey } : {}),
    })
    return NextResponse.json(result, { status: 200 })
  } catch (err) {
    return backendFailure(err)
  }
}
