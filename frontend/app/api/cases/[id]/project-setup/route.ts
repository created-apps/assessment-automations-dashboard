import { NextResponse } from "next/server"
import { z } from "zod"

import { getProjectSetup, saveProjectSetup } from "@/lib/backend"
import { backendFailure, requireAdmin, requireUser } from "@/lib/route-helpers"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/** The Stage 5 details entered so far (or null). Any signed-in user may read. */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireUser()
  if (!auth.ok) return auth.response

  const { id } = await params
  try {
    return NextResponse.json(await getProjectSetup(id))
  } catch (err) {
    return backendFailure(err)
  }
}

const bodySchema = z.object({
  project_title: z.string().trim().min(1),
  project_description: z.string().trim().max(4000).optional(),
  curriculum_subject: z.string().trim().max(200).optional(),
})

/**
 * Save the project title / description / curriculum choice and mark the case
 * ready for the project-setup service to run.
 *
 * This queues automation (WhatsApp update, SYNC link, Drive) that will send
 * real messages, so it is admin-only. The actor is taken from the session,
 * never the body, so a submission is always attributed to who is signed in.
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
    const result = await saveProjectSetup(id, {
      ...parsed.data,
      actor: auth.user.name,
    })
    return NextResponse.json(result, { status: 200 })
  } catch (err) {
    return backendFailure(err)
  }
}
