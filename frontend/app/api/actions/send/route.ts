import { NextResponse } from "next/server"

import { getCurrentUser } from "@/lib/current-user"

/**
 * Authorization gate for message-sending actions. Every action dialog calls
 * this before recording anything. Disabling buttons for viewers is only a
 * convenience — this endpoint is the real enforcement point: a viewer POSTing
 * directly receives a 403. In a production build this is also where the actual
 * WhatsApp send would be dispatched, attributed to the session user.
 */
export async function POST() {
  const user = await getCurrentUser()

  if (!user) {
    return NextResponse.json({ error: "You are not signed in." }, { status: 401 })
  }

  if (user.role !== "admin") {
    return NextResponse.json(
      { error: "Read-only access — ask an admin to send this" },
      { status: 403 },
    )
  }

  // Authorized — return the actor so the action is traceable to this user.
  return NextResponse.json({ actor: user.name })
}
