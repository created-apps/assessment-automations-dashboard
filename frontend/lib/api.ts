import type {
  CaseAction,
  CaseSummary,
  GroupCase,
  MeetingHost,
  Mentor,
  ProjectSetup,
  QueuedAction,
} from "./types"

/**
 * The browser's data layer.
 *
 * Everything here calls this app's own routes under /api, which authenticate
 * the session and then talk to the automations backend. The backend's URL and
 * token stay on the server — nothing in this file knows them.
 *
 * Function signatures are unchanged from the mock implementation these
 * replaced, so the components calling them did not need to change.
 */

interface ErrorBody {
  error?: string
  suggestions?: string[]
  available?: string[]
}

/** An error carrying whatever the server offered to help the user recover. */
export class ApiError extends Error {
  status: number
  suggestions?: string[]

  constructor(message: string, status: number, suggestions?: string[]) {
    super(message)
    this.name = "ApiError"
    this.status = status
    this.suggestions = suggestions
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  })

  const text = await res.text()
  let data: unknown = null
  try {
    data = text ? JSON.parse(text) : null
  } catch {
    data = null
  }

  if (!res.ok) {
    const body = (data ?? {}) as ErrorBody
    const hints = body.suggestions ?? body.available
    throw new ApiError(
      body.error ?? `Request failed (${res.status})`,
      res.status,
      hints,
    )
  }

  return data as T
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export function listCaseSummaries(): Promise<CaseSummary[]> {
  return request<CaseSummary[]>("/api/cases")
}

/** Kept for parity with the previous data layer; the list view uses summaries. */
export function listCases(): Promise<GroupCase[]> {
  return request<GroupCase[]>("/api/cases")
}

export async function getCase(id: string): Promise<GroupCase | null> {
  try {
    return await request<GroupCase>(`/api/cases/${encodeURIComponent(id)}`)
  } catch (err) {
    // A missing group is an empty state, not an error the page should throw on.
    if (err instanceof ApiError && err.status === 404) return null
    throw err
  }
}

export function getCaseActions(caseId: string): Promise<CaseAction[]> {
  return request<CaseAction[]>(
    `/api/cases/${encodeURIComponent(caseId)}/actions`,
  )
}

export function listMentors(): Promise<Mentor[]> {
  return request<Mentor[]>("/api/mentors")
}

/** Add a mentor to the directory. Admin-only (enforced server-side). */
export function createMentor(body: {
  name: string
  intro: string
  email?: string
  phone?: string
}): Promise<Mentor> {
  return request<Mentor>("/api/mentors", {
    method: "POST",
    body: JSON.stringify(body),
  })
}

export interface MentorEdit {
  intro?: string
  /** null clears the address; omitted leaves it alone. */
  email?: string | null
  phone?: string | null
}

/**
 * Change a mentor's introduction, email or phone. Admin-only (enforced
 * server-side). Send only the fields being changed.
 */
export function updateMentor(name: string, body: MentorEdit): Promise<Mentor> {
  return request<Mentor>(`/api/mentors/${encodeURIComponent(name)}`, {
    method: "PATCH",
    body: JSON.stringify(body),
  })
}

export function getProjectSetup(caseId: string): Promise<ProjectSetup | null> {
  return request<ProjectSetup | null>(
    `/api/cases/${encodeURIComponent(caseId)}/project-setup`,
  )
}

export async function listCurriculumSubjects(): Promise<string[]> {
  const { subjects } = await request<{ subjects: string[] }>(
    "/api/curriculum-subjects",
  )
  return subjects
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

interface ActionResult {
  case: GroupCase
  action: CaseAction
  replayed: boolean
}

/**
 * A key identifying this instruction, so the same one can't be sent twice.
 *
 * Derived from what is being sent rather than generated fresh, because the
 * failure worth preventing is a person clicking Send again after a request
 * appeared to hang — a random key per click would let that through and a
 * family would get the message twice. The ten-minute bucket keeps it stable
 * across those retries while still allowing a deliberate re-send later.
 */
function idempotencyKey(caseId: string, parts: (string | undefined)[]): string {
  const bucket = Math.floor(Date.now() / (10 * 60 * 1000))
  return [caseId, ...parts.filter(Boolean), bucket].join("|")
}

function send(
  caseId: string,
  body: Record<string, unknown>,
): Promise<ActionResult> {
  return request<ActionResult>(
    `/api/cases/${encodeURIComponent(caseId)}/actions`,
    { method: "POST", body: JSON.stringify(body) },
  )
}

/**
 * `actor` is accepted so existing callers keep working, but it is ignored:
 * the server takes the actor from the session, so a client cannot send a
 * message under another person's name.
 */
export function sendCsAssessment(
  caseId: string,
  deadlineIso: string,
  _actor?: string,
): Promise<ActionResult> {
  return send(caseId, {
    kind: "CS_ASSESSMENT",
    deadline: deadlineIso,
    idempotency_key: idempotencyKey(caseId, ["CS_ASSESSMENT", deadlineIso]),
  })
}

export function sendPrototypingAssessment(
  caseId: string,
  deadlineIso: string,
  _actor?: string,
): Promise<ActionResult> {
  return send(caseId, {
    kind: "PROTOTYPING_ASSESSMENT",
    deadline: deadlineIso,
    idempotency_key: idempotencyKey(caseId, [
      "PROTOTYPING_ASSESSMENT",
      deadlineIso,
    ]),
  })
}

export function scheduleMeeting(
  caseId: string,
  host: MeetingHost,
  _actor?: string,
): Promise<ActionResult> {
  return send(caseId, {
    kind: "SCHEDULE_MEETING",
    host,
    idempotency_key: idempotencyKey(caseId, ["SCHEDULE_MEETING", host]),
  })
}

export function addMentor(
  caseId: string,
  mentorName: string,
  variant?: string,
  _actor?: string,
): Promise<ActionResult> {
  return send(caseId, {
    kind: "ADD_MENTOR",
    mentor: mentorName,
    ...(variant ? { variant } : {}),
    idempotency_key: idempotencyKey(caseId, ["ADD_MENTOR", mentorName, variant]),
  })
}

/**
 * Save the Stage 5 project details and mark the case ready for the
 * project-setup service. Unlike the sends above, this records intent only --
 * the setup cron does the WhatsApp/Drive/SYNC work. Actor comes from the
 * session server-side, so none is passed here.
 */
export function saveProjectSetup(
  caseId: string,
  body: {
    project_title: string
    project_description?: string
    curriculum_subject?: string
  },
): Promise<ProjectSetup> {
  return request<ProjectSetup>(
    `/api/cases/${encodeURIComponent(caseId)}/project-setup`,
    { method: "POST", body: JSON.stringify(body) },
  )
}

export interface StopResult {
  case: GroupCase
  cancelled: number
  already_stopped: boolean
}

/**
 * Stop every automation for one project, permanently.
 *
 * No idempotency key: the server keys on the case already being stopped, so a
 * double-click reports the first stop rather than overwriting it.
 */
export function stopOperations(
  caseId: string,
  reason?: string,
): Promise<StopResult> {
  return request<StopResult>(`/api/cases/${encodeURIComponent(caseId)}/stop`, {
    method: "POST",
    body: JSON.stringify(reason ? { reason } : {}),
  })
}

// ---------------------------------------------------------------------------
// Queued actions
//
// A case that nobody has joined yet can have its follow-up lined up in
// advance. The dashboard uses these instead of the send-now calls while the
// case is AWAITING_JOIN; the runner sends them, in order, once the welcome has
// fired. Assessments carry a number of DAYS rather than a date, so a queue
// that waits on a family still sends a deadline that is that far away.
// ---------------------------------------------------------------------------

export type QueueBody =
  | { kind: "ADD_MENTOR"; mentor: string; variant?: string }
  | { kind: "CS_ASSESSMENT"; deadline_days: number }
  | { kind: "PROTOTYPING_ASSESSMENT"; deadline_days: number }
  | { kind: "SCHEDULE_MEETING"; host: string }

export function getQueue(caseId: string): Promise<QueuedAction[]> {
  return request<QueuedAction[]>(`/api/cases/${encodeURIComponent(caseId)}/queue`)
}

export function queueAction(
  caseId: string,
  body: QueueBody,
): Promise<QueuedAction> {
  return request<QueuedAction>(`/api/cases/${encodeURIComponent(caseId)}/queue`, {
    method: "POST",
    body: JSON.stringify(body),
  })
}

export function cancelQueuedAction(
  caseId: string,
  queuedId: string,
): Promise<void> {
  return request<void>(
    `/api/cases/${encodeURIComponent(caseId)}/queue/${encodeURIComponent(queuedId)}`,
    { method: "DELETE" },
  )
}
