import { NextResponse } from "next/server"

import { cancelQueued } from "@/lib/backend"
import { backendFailure, requireAdmin } from "@/lib/route-helpers"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/** Drop something that hasn't been sent yet. Sent actions are history. */
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string; queuedId: string }> },
) {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.response

  const { id, queuedId } = await params
  try {
    await cancelQueued(id, queuedId)
    return new NextResponse(null, { status: 204 })
  } catch (err) {
    return backendFailure(err)
  }
}
