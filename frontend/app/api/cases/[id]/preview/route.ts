import { NextResponse } from "next/server"

import { previewMessage, type ActionBody } from "@/lib/backend"
import { backendFailure, requireUser } from "@/lib/route-helpers"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/**
 * Render the message an action would send, without sending it.
 *
 * Any signed-in user may preview — a viewer should be able to read exactly
 * what an admin would send, they just cannot send it.
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireUser()
  if (!auth.ok) return auth.response

  const { id } = await params

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 })
  }

  try {
    return NextResponse.json(await previewMessage(id, body as ActionBody))
  } catch (err) {
    return backendFailure(err)
  }
}
