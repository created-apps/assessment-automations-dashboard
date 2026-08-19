/**
 * Client helper that asks the server to authorize a message-sending action.
 * Resolves with the actor name (the session user) on success, or throws with a
 * user-facing message when the server rejects (e.g. a viewer gets 403).
 */
export async function authorizeSend(): Promise<string> {
  const res = await fetch("/api/actions/send", { method: "POST" })
  if (!res.ok) {
    const data = (await res.json().catch(() => null)) as { error?: string } | null
    throw new Error(data?.error ?? "You do not have permission to send this.")
  }
  const data = (await res.json()) as { actor: string }
  return data.actor
}
