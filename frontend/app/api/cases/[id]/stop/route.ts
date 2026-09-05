import { NextResponse } from "next/server"
import { z } from "zod"

import { stopOperations } from "@/lib/backend"
import { backendFailure, requireAdmin } from "@/lib/route-helpers"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const bodySchema = z.object({ reason: z.string().trim().max(2000).optional() })

/**
 * Stop every automation for one project.
 *
 * Admin-only, on the same footing as sending: this decides that a family stops
 * hearing from us, which is as consequential as deciding they should. The
 * actor comes from the session and never from the body — the record of who
 * stopped a project has to be trustworthy.
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.response

  const { id } = await params

  // An empty body is normal here — the reason is optional.
  const raw = await req.json().catch(() => ({}))
  const parsed = bodySchema.safeParse(raw ?? {})
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 })
  }

  try {
    const result = await stopOperations(id, {
      actor: auth.user.name,
      ...(parsed.data.reason ? { reason: parsed.data.reason } : {}),
    })
    return NextResponse.json(result, { status: 200 })
  } catch (err) {
    return backendFailure(err)
  }
}
