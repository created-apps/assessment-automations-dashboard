import { NextResponse } from "next/server"

import { getCase } from "@/lib/backend"
import { backendFailure, requireUser } from "@/lib/route-helpers"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireUser()
  if (!auth.ok) return auth.response

  const { id } = await params
  try {
    return NextResponse.json(await getCase(id))
  } catch (err) {
    return backendFailure(err)
  }
}
