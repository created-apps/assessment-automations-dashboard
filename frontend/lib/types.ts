export type Stage =
  /** Group made, family not in it yet. Visible so its project can be filled in. */
  | "AWAITING_JOIN"
  | "NEW"
  | "IN_PROGRESS"
  /** Mentor picked and invited, but not in the group yet -- intro is held. */
  | "AWAITING_MENTOR_JOIN"
  | "MENTOR_ASSIGNED"
  | "ABANDONED"

export interface GroupCase {
  id: string
  chat_id: string
  group_name: string
  student_name: string
  student_phone: string | null
  student_email: string | null
  parent_name: string | null
  parent_phone: string | null
  parent_email: string | null
  project_name: string | null
  source: string | null
  sheet_row: number | null
  invite_link: string | null
  stage: Stage
  mentor_name: string | null
  mentor_intro_sent_at: string | null
  /** Introduction written but not sent: the mentor isn't in the group yet. */
  pending_mentor_name: string | null
  pending_mentor_since: string | null
  mentor_joined_at: string | null
  /** Set once SYNC has a meeting for the group; ends the first-class chase. */
  first_class_confirmed_at: string | null
  first_class_confirmed_reason: string | null
  first_class_prompt_count: number
  first_class_prompted_at: string | null
  last_nudged_at: string | null
  nudge_count: number
  created_at: string
  updated_at: string
}

export type ActionKind =
  | "ADD_MENTOR"
  | "CS_ASSESSMENT"
  | "PROTOTYPING_ASSESSMENT"
  | "SCHEDULE_MEETING"

export interface CaseAction {
  id: string
  case_id: string
  kind: ActionKind
  status: "PENDING" | "OK" | "FAILED"
  detail: Record<string, unknown> | null
  error: string | null
  actor: string | null
  created_at: string
}

export interface Mentor {
  name: string
  intro: string
  variants?: Record<string, string>
  email?: string | null
  phone?: string | null
}

/**
 * Stage 5 project-setup details, entered from the dashboard and then acted on
 * by the project-setup service. The top half is what the dashboard writes; the
 * step_* fields and drive_folder_url are that service's progress, shown
 * read-only. `null` for the whole thing means nothing has been entered yet.
 */
export type SetupStatus = "PENDING" | "RUNNING" | "DONE" | "FAILED"
export type SetupStepStatus = "PENDING" | "OK" | "FAILED" | "SKIPPED"

export interface ProjectSetup {
  case_id: string
  project_title: string | null
  project_description: string | null
  curriculum_subject: string | null
  submitted_at: string | null
  submitted_by: string | null
  status: SetupStatus
  step_whatsapp: SetupStepStatus
  /** The Drive link appended to the group description, once there is a folder. */
  step_whatsapp_drive_link: SetupStepStatus
  step_sync: SetupStepStatus
  step_drive: SetupStepStatus
  /** The mentor's editor access to the student's Drive folder. */
  step_mentor_access: SetupStepStatus
  step_curriculum: SetupStepStatus
  step_cosmic_student: SetupStepStatus
  step_cosmic_project: SetupStepStatus
  step_cosmic_sync_group: SetupStepStatus
  drive_folder_url: string | null
  cosmic_student_id: string | null
  cosmic_project_id: string | null
  last_error: string | null
}

export type MeetingHost =
  | "Aashna Saraf"
  | "Urja Jhaveri"
  | "Dhruv Singh"
  | "Dhruv + Aashna"
  | "Urja + Aashna"

export interface CaseSummary extends GroupCase {
  last_action_kind: ActionKind | null
  last_action_at: string | null
}

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

export type Role = "admin" | "viewer"

/** The public shape of a user — never includes password_hash. */
export interface SessionUser {
  id: string
  email: string
  name: string
  role: Role
}

/** JWT payload stored in the httpOnly session cookie. */
export interface SessionPayload {
  sub: string
  email: string
  name: string
  role: Role
}

/** An action lined up to run once the family has joined and been welcomed. */
export type QueuedStatus = "QUEUED" | "SENT" | "FAILED" | "CANCELLED"

export interface QueuedAction {
  id: string
  case_id: string
  position: number
  kind: ActionKind
  /**
   * What the action needs when it runs. Assessments carry `deadline_days`
   * rather than a date: the queue can wait days on a family joining, so the
   * date is worked out at send time and is never stale.
   */
  params: Record<string, unknown>
  status: QueuedStatus
  queued_by: string | null
  error: string | null
  sent_at: string | null
  created_at: string
}
