import useSWR from "swr"

import { ApiError } from "./api"

/**
 * Message previews.
 *
 * The copy is NOT written here. Every preview is rendered by the backend, by
 * the same templates that produce the message actually sent to the family —
 * writing it a second time in the dashboard would eventually show an operator
 * one message while a family received another, which is precisely what the
 * preview exists to prevent.
 */

export type PreviewBody =
  | { kind: "ADD_MENTOR"; mentor: string; variant?: string }
  | { kind: "CS_ASSESSMENT"; deadline: string }
  | { kind: "PROTOTYPING_ASSESSMENT"; deadline: string }
  | { kind: "SCHEDULE_MEETING"; host: string }

export function formatMessageDate(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
  })
}

async function fetchPreview(
  caseId: string,
  body: PreviewBody,
): Promise<string> {
  const res = await fetch(`/api/cases/${encodeURIComponent(caseId)}/preview`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
  const data = (await res.json().catch(() => null)) as
    | { message?: string; error?: string }
    | null
  if (!res.ok) {
    throw new ApiError(data?.error ?? "Could not render a preview.", res.status)
  }
  return data?.message ?? ""
}

/**
 * Live preview of what would be sent.
 *
 * Returns `null` while loading or when the inputs aren't complete enough to
 * render anything, so callers can hold the send button until a real preview
 * has been seen.
 */
export function useMessagePreview(caseId: string, body: PreviewBody | null) {
  const { data, error, isLoading } = useSWR(
    body ? ["preview", caseId, JSON.stringify(body)] : null,
    () => fetchPreview(caseId, body as PreviewBody),
    { revalidateOnFocus: false, keepPreviousData: true },
  )

  return {
    message: data ?? null,
    error: error instanceof Error ? error.message : null,
    isLoading,
  }
}
