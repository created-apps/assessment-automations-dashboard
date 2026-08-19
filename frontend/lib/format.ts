import type { ActionKind, Stage } from "./types"

export function relativeTime(iso: string | null | undefined): string {
  if (!iso) return "—"
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return "—"
  const diffMs = Date.now() - then
  const abs = Math.abs(diffMs)
  const future = diffMs < 0

  const mins = Math.round(abs / 60000)
  const hours = Math.round(abs / 3600000)
  const days = Math.round(abs / 86400000)

  let label: string
  if (mins < 1) label = "just now"
  else if (mins < 60) label = `${mins}m`
  else if (hours < 24) label = `${hours}h`
  else if (days < 30) label = `${days}d`
  else label = `${Math.round(days / 30)}mo`

  if (label === "just now") return label
  return future ? `in ${label}` : `${label} ago`
}

export function daysSince(iso: string): number {
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return 0
  return Math.floor((Date.now() - then) / 86400000)
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—"
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return "—"
  return d.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  })
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "—"
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return "—"
  return d.toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  })
}

export function formatPhone(raw: string | null | undefined): string {
  if (!raw) return "—"
  const digits = raw.replace(/[^\d+]/g, "")
  // Indian numbers: +91 XXXXX XXXXX
  const m = digits.match(/^\+?91?(\d{5})(\d{5})$/)
  if (m) return `+91 ${m[1]} ${m[2]}`
  return raw
}

export const STAGE_LABELS: Record<Stage, string> = {
  NEW: "New",
  IN_PROGRESS: "In progress",
  MENTOR_ASSIGNED: "Mentor assigned",
  ABANDONED: "Abandoned",
}

export const ACTION_LABELS: Record<ActionKind, string> = {
  ADD_MENTOR: "Introduced mentor",
  CS_ASSESSMENT: "Sent Computer Science assessment",
  PROTOTYPING_ASSESSMENT: "Sent Prototyping assessment",
  SCHEDULE_MEETING: "Sent booking link",
}

export const ACTION_SHORT: Record<ActionKind, string> = {
  ADD_MENTOR: "Mentor intro",
  CS_ASSESSMENT: "CS assessment",
  PROTOTYPING_ASSESSMENT: "Prototyping",
  SCHEDULE_MEETING: "Booking link",
}
