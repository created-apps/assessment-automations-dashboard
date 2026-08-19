import { NextResponse } from "next/server"

import { listCaseSummaries } from "@/lib/backend"
import { backendFailure, requireUser } from "@/lib/route-helpers"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/** The list view: every group with its most recent action folded in. */
export async function GET() {
  const auth = await requireUser()
  if (!auth.ok) return auth.response

  try {
    return NextResponse.json(await listCaseSummaries())
  } catch (err) {
    return backendFailure(err)
  }
}
