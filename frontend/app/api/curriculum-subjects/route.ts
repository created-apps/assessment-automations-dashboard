import { NextResponse } from "next/server"

import { listCurriculumSubjects } from "@/lib/backend"
import { backendFailure, requireUser } from "@/lib/route-helpers"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/** The curriculum subjects the Project Setup action offers. Any user may read. */
export async function GET() {
  const auth = await requireUser()
  if (!auth.ok) return auth.response

  try {
    return NextResponse.json(await listCurriculumSubjects())
  } catch (err) {
    return backendFailure(err)
  }
}
