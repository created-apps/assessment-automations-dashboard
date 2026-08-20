import type {
  CaseAction,
  CaseSummary,
  GroupCase,
  Mentor,
  ProjectSetup,
} from "./types"

/**
 * SERVER ONLY. Never import this from a Client Component.
 *
 * Talks to the assessment-automations backend, which holds the Supabase
 * service key and the Periskope credentials. The bearer token here is what
 * authorises this dashboard to that backend, so it must never be bundled into
 * anything the browser downloads — which is why the browser talks to our own
 * route handlers under /api instead, and they call this.
 */

const BASE = (process.env.BACKEND_API_URL ?? "").replace(/\/+$/, "")
const SECRET = process.env.BACKEND_API_SECRET ?? ""

export class BackendError extends Error {
  status: number
  details: Record<string, unknown>

  constructor(message: string, status: number, details: Record<string, unknown> = {}) {
    super(message)
    this.name = "BackendError"
    this.status = status
    this.details = details
  }
}

export function isConfigured(): boolean {
  return Boolean(BASE && SECRET)
}

async function call<T>(
  path: string,
  init: { method?: string; body?: unknown } = {},
): Promise<T> {
  if (!isConfigured()) {
    throw new BackendError(
      "BACKEND_API_URL and BACKEND_API_SECRET are not set",
      503,
    )
  }

  let res: Response
  try {
    res = await fetch(`${BASE}${path}`, {
      method: init.method ?? "GET",
      headers: {
        "Content-Type": "application/json",
        authorization: `Bearer ${SECRET}`,
      },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      // Always live: this data changes as the team works through it.
      cache: "no-store",
    })
  } catch (err) {
    throw new BackendError(
      `Cannot reach the automations backend: ${
        err instanceof Error ? err.message : String(err)
      }`,
      502,
    )
  }

  const text = await res.text()
  let data: unknown = null
  try {
    data = text ? JSON.parse(text) : null
  } catch {
    data = { error: text.slice(0, 300) }
  }

  if (!res.ok) {
    const body = (data ?? {}) as Record<string, unknown>
    throw new BackendError(
      typeof body.error === "string" ? body.error : `Backend returned ${res.status}`,
      res.status,
      body,
    )
  }

  return data as T
}

// --- Reads -----------------------------------------------------------------

export function listCaseSummaries(): Promise<CaseSummary[]> {
  return call<CaseSummary[]>("/api/cases/summaries")
}

export function getCase(id: string): Promise<GroupCase> {
  return call<GroupCase>(`/api/cases/${encodeURIComponent(id)}`)
}

export function getCaseActions(id: string): Promise<CaseAction[]> {
  return call<CaseAction[]>(`/api/cases/${encodeURIComponent(id)}/actions`)
}

export function listMentors(): Promise<Mentor[]> {
  return call<Mentor[]>("/api/mentors")
}

export interface NewMentorBody {
  name: string
  intro: string
  email?: string
  /** Required: keys the mentor's SYNC account and receives their group invite. */
  phone: string
  actor?: string
}

export function createMentor(body: NewMentorBody): Promise<Mentor> {
  return call<Mentor>("/api/mentors", { method: "POST", body })
}

export function getProjectSetup(id: string): Promise<ProjectSetup | null> {
  return call<ProjectSetup | null>(
    `/api/cases/${encodeURIComponent(id)}/project-setup`,
  )
}

export function listCurriculumSubjects(): Promise<{ subjects: string[] }> {
  return call<{ subjects: string[] }>("/api/curriculum-subjects")
}

// --- Actions ---------------------------------------------------------------

export type ActionBody =
  | { kind: "ADD_MENTOR"; mentor: string; variant?: string }
  | { kind: "CS_ASSESSMENT"; deadline: string }
  | { kind: "PROTOTYPING_ASSESSMENT"; deadline: string }
  | { kind: "SCHEDULE_MEETING"; host: string }

export interface ActionResult {
  case: GroupCase
  action: CaseAction
  /** True when this key had already run and nothing was sent again. */
  replayed: boolean
}

/** The exact message an action would send, rendered by the same templates. */
export function previewMessage(
  caseId: string,
  body: ActionBody,
): Promise<{ message: string }> {
  return call<{ message: string }>(
    `/api/cases/${encodeURIComponent(caseId)}/preview`,
    { method: "POST", body },
  )
}

export function performAction(
  caseId: string,
  body: ActionBody & { actor?: string; idempotency_key?: string },
): Promise<ActionResult> {
  return call<ActionResult>(
    `/api/cases/${encodeURIComponent(caseId)}/actions`,
    { method: "POST", body },
  )
}

export interface ProjectSetupBody {
  project_title: string
  project_description?: string
  curriculum_subject?: string
  actor?: string
}

/**
 * Save the Stage 5 details and mark the case ready for the project-setup
 * service. Records intent only -- nothing is sent from here.
 */
export function saveProjectSetup(
  caseId: string,
  body: ProjectSetupBody,
): Promise<ProjectSetup> {
  return call<ProjectSetup>(
    `/api/cases/${encodeURIComponent(caseId)}/project-setup`,
    { method: "POST", body },
  )
}
