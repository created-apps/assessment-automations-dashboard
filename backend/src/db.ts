import { config } from './config';

/**
 * Storage for this service, over the Supabase REST API.
 *
 * The tables live in the group-creation service's database (see
 * sql/001_init.sql) and are reached with the service key, which bypasses row
 * level security. Rows come back in snake_case; everything above this module
 * works in camelCase with real Date objects, so the mapping happens here and
 * nowhere else.
 */

export class DbError extends Error {
  status: number;
  details: unknown;

  constructor(message: string, status: number, details: unknown) {
    super(message);
    this.name = 'DbError';
    this.status = status;
    this.details = details;
  }
}

async function call<T>(
  method: 'GET' | 'POST' | 'PATCH',
  pathname: string,
  init: { body?: unknown; prefer?: string } = {}
): Promise<T> {
  const res = await fetch(`${config.supabase.url}/rest/v1${pathname}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      apikey: config.supabase.serviceKey,
      authorization: `Bearer ${config.supabase.serviceKey}`,
      ...(init.prefer ? { Prefer: init.prefer } : {}),
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });

  const text = await res.text();
  let data: unknown;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { raw: text };
  }

  if (!res.ok) {
    throw new DbError(
      `Supabase ${method} ${pathname.split('?')[0]} returned ${res.status}: ${text.slice(0, 500)}`,
      res.status,
      data
    );
  }

  return data as T;
}

/**
 * AWAITING_JOIN is where a case starts now: the WhatsApp group exists and the
 * dashboard shows the project, but the family hasn't joined, so there is no
 * Slack thread yet. Handover moves it to NEW.
 */
export type CaseStage =
  | 'AWAITING_JOIN'
  | 'NEW'
  | 'IN_PROGRESS'
  /** Mentor picked and invited, but not in the group yet -- intro is held. */
  | 'AWAITING_MENTOR_JOIN'
  | 'MENTOR_ASSIGNED'
  | 'ABANDONED';

export type ActionKind =
  | 'ADD_MENTOR'
  | 'CS_ASSESSMENT'
  | 'PROTOTYPING_ASSESSMENT'
  | 'SCHEDULE_MEETING';

export type ActionStatus = 'PENDING' | 'OK' | 'FAILED';

export interface GroupCase {
  id: string;
  chatId: string;
  groupName: string;
  studentName: string;
  studentPhone: string | null;
  studentEmail: string | null;
  parentName: string | null;
  parentPhone: string | null;
  parentEmail: string | null;
  projectName: string | null;
  source: string | null;
  sheetRow: number | null;
  groupRequestId: string | null;
  supabaseGroupId: string | null;
  inviteLink: string | null;
  payload: unknown;
  stage: CaseStage;
  mentorName: string | null;
  mentorRequestedName: string | null;
  mentorIntroSentAt: Date | null;
  /** The mentor's SYNC users.id, stamped at introduction. */
  mentorSyncUserId: string | null;
  /** The assignment being held until the mentor joins; null once delivered. */
  pendingMentorName: string | null;
  pendingMentorVariant: string | null;
  pendingMentorSince: Date | null;
  /** First time the mentor was seen in the group's member list. */
  mentorJoinedAt: Date | null;
  /** Set when SYNC has a meeting for this group -- ends the first-class chase. */
  firstClassConfirmedAt: Date | null;
  firstClassConfirmedReason: string | null;
  firstClassFirstPromptedAt: Date | null;
  firstClassPromptedAt: Date | null;
  firstClassPromptCount: number;
  firstClassEscalatedAt: Date | null;
  /** Null until handover opens the thread (see AWAITING_JOIN). */
  slackChannel: string | null;
  slackThreadTs: string | null;
  lastNudgedAt: Date | null;
  nudgeCount: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface CaseAction {
  id: string;
  caseId: string;
  kind: ActionKind;
  command: string;
  slackUser: string | null;
  slackTs: string | null;
  /** Which signed-in dashboard user triggered this. */
  actor: string | null;
  idempotencyKey: string | null;
  detail: unknown;
  status: ActionStatus;
  error: string | null;
  createdAt: Date;
}

interface GroupCaseRow {
  id: string;
  chat_id: string;
  group_name: string;
  student_name: string;
  student_phone: string | null;
  student_email: string | null;
  parent_name: string | null;
  parent_phone: string | null;
  parent_email: string | null;
  project_name: string | null;
  source: string | null;
  sheet_row: number | null;
  group_request_id: string | null;
  supabase_group_id: string | null;
  invite_link: string | null;
  payload: unknown;
  stage: CaseStage;
  mentor_name: string | null;
  mentor_requested_name: string | null;
  mentor_intro_sent_at: string | null;
  mentor_sync_user_id: string | null;
  pending_mentor_name: string | null;
  pending_mentor_variant: string | null;
  pending_mentor_since: string | null;
  mentor_joined_at: string | null;
  first_class_confirmed_at: string | null;
  first_class_confirmed_reason: string | null;
  first_class_first_prompted_at: string | null;
  first_class_prompted_at: string | null;
  first_class_prompt_count: number;
  first_class_escalated_at: string | null;
  slack_channel: string | null;
  slack_thread_ts: string | null;
  last_nudged_at: string | null;
  nudge_count: number;
  created_at: string;
  updated_at: string;
}

interface CaseActionRow {
  id: string;
  case_id: string;
  kind: ActionKind;
  command: string;
  slack_user: string | null;
  slack_ts: string | null;
  actor: string | null;
  idempotency_key: string | null;
  detail: unknown;
  status: ActionStatus;
  error: string | null;
  created_at: string;
}

/**
 * A timestamp column into a Date.
 *
 * Undefined is treated as null, not as `new Date(undefined)`: a column added by
 * a migration that hasn't been run yet comes back absent rather than null, and
 * an Invalid Date would propagate silently into comparisons.
 */
const date = (value: string | null | undefined): Date | null =>
  value === null || value === undefined ? null : new Date(value);

function toCase(row: GroupCaseRow): GroupCase {
  return {
    id: row.id,
    chatId: row.chat_id,
    groupName: row.group_name,
    studentName: row.student_name,
    studentPhone: row.student_phone,
    studentEmail: row.student_email,
    parentName: row.parent_name,
    parentPhone: row.parent_phone,
    parentEmail: row.parent_email,
    projectName: row.project_name,
    source: row.source,
    sheetRow: row.sheet_row,
    groupRequestId: row.group_request_id,
    supabaseGroupId: row.supabase_group_id,
    inviteLink: row.invite_link,
    payload: row.payload,
    stage: row.stage,
    mentorName: row.mentor_name,
    mentorRequestedName: row.mentor_requested_name,
    mentorIntroSentAt: date(row.mentor_intro_sent_at),
    mentorSyncUserId: row.mentor_sync_user_id,
    pendingMentorName: row.pending_mentor_name,
    pendingMentorVariant: row.pending_mentor_variant,
    pendingMentorSince: date(row.pending_mentor_since),
    mentorJoinedAt: date(row.mentor_joined_at),
    firstClassConfirmedAt: date(row.first_class_confirmed_at),
    firstClassConfirmedReason: row.first_class_confirmed_reason,
    firstClassFirstPromptedAt: date(row.first_class_first_prompted_at),
    firstClassPromptedAt: date(row.first_class_prompted_at),
    firstClassPromptCount: row.first_class_prompt_count ?? 0,
    firstClassEscalatedAt: date(row.first_class_escalated_at),
    slackChannel: row.slack_channel,
    slackThreadTs: row.slack_thread_ts,
    lastNudgedAt: date(row.last_nudged_at),
    nudgeCount: row.nudge_count,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
}

function toAction(row: CaseActionRow): CaseAction {
  return {
    id: row.id,
    caseId: row.case_id,
    kind: row.kind,
    command: row.command,
    slackUser: row.slack_user,
    slackTs: row.slack_ts,
    actor: row.actor,
    idempotencyKey: row.idempotency_key,
    detail: row.detail,
    status: row.status,
    error: row.error,
    createdAt: new Date(row.created_at),
  };
}

const CASE_COLUMNS = '*';

export async function findCaseByChatId(
  chatId: string
): Promise<GroupCase | null> {
  const params = new URLSearchParams({
    select: CASE_COLUMNS,
    chat_id: `eq.${chatId}`,
    limit: '1',
  });
  const rows = await call<GroupCaseRow[]>('GET', `/group_cases?${params}`);
  return rows[0] ? toCase(rows[0]) : null;
}

export async function findCaseByThreadTs(
  threadTs: string
): Promise<GroupCase | null> {
  const params = new URLSearchParams({
    select: CASE_COLUMNS,
    slack_thread_ts: `eq.${threadTs}`,
    limit: '1',
  });
  const rows = await call<GroupCaseRow[]>('GET', `/group_cases?${params}`);
  return rows[0] ? toCase(rows[0]) : null;
}

export async function listCasesByStage(stage: CaseStage): Promise<GroupCase[]> {
  const params = new URLSearchParams({
    select: CASE_COLUMNS,
    stage: `eq.${stage}`,
    order: 'created_at.asc',
  });
  const rows = await call<GroupCaseRow[]>('GET', `/group_cases?${params}`);
  return rows.map(toCase);
}

/**
 * Cases whose mentor introduction is written but not yet sent, oldest first.
 *
 * The five-minute job's working set. Filtered on the parked assignment rather
 * than on the stage, so an introduction can never be stranded by a case that
 * moved stage some other way.
 */
export async function listCasesAwaitingMentorJoin(): Promise<GroupCase[]> {
  const params = new URLSearchParams({
    select: CASE_COLUMNS,
    pending_mentor_name: 'not.is.null',
    order: 'pending_mentor_since.asc',
  });
  const rows = await call<GroupCaseRow[]>('GET', `/group_cases?${params}`);
  return rows.map(toCase);
}

/**
 * Cases whose family should be asked when they want their first class: the
 * introduction has landed and no meeting has been found on SYNC yet.
 *
 * A case with no supabase_group_id cannot be looked up on SYNC at all, so it
 * is excluded here rather than fetched and discarded every morning.
 */
export async function listCasesAwaitingFirstClass(): Promise<GroupCase[]> {
  const params = new URLSearchParams({
    select: CASE_COLUMNS,
    stage: 'eq.MENTOR_ASSIGNED',
    first_class_confirmed_at: 'is.null',
    supabase_group_id: 'not.is.null',
    order: 'created_at.asc',
  });
  const rows = await call<GroupCaseRow[]>('GET', `/group_cases?${params}`);
  return rows.map(toCase);
}

/** Every case, newest first -- the dashboard's list view. */
export async function listCases(): Promise<GroupCase[]> {
  const params = new URLSearchParams({
    select: CASE_COLUMNS,
    order: 'created_at.desc',
  });
  const rows = await call<GroupCaseRow[]>('GET', `/group_cases?${params}`);
  return rows.map(toCase);
}

export async function findCaseById(id: string): Promise<GroupCase | null> {
  const params = new URLSearchParams({
    select: CASE_COLUMNS,
    id: `eq.${id}`,
    limit: '1',
  });
  const rows = await call<GroupCaseRow[]>('GET', `/group_cases?${params}`);
  return rows[0] ? toCase(rows[0]) : null;
}

/** Actions for one case, newest first. */
export async function listActionsForCase(
  caseId: string
): Promise<CaseAction[]> {
  const params = new URLSearchParams({
    select: '*',
    case_id: `eq.${caseId}`,
    order: 'created_at.desc',
  });
  const rows = await call<CaseActionRow[]>('GET', `/case_actions?${params}`);
  return rows.map(toAction);
}

/**
 * The newest action for every case, in one request.
 *
 * The list view shows "last action" per row; fetching that per case would be
 * one round trip per row. Ordered newest-first so the caller can keep the
 * first occurrence of each case_id and discard the rest.
 */
export async function listLatestActions(): Promise<CaseAction[]> {
  const params = new URLSearchParams({
    select: '*',
    order: 'created_at.desc',
  });
  const rows = await call<CaseActionRow[]>('GET', `/case_actions?${params}`);
  return rows.map(toAction);
}

export interface NewCase {
  chatId: string;
  groupName: string;
  studentName: string;
  studentPhone?: string | null;
  studentEmail?: string | null;
  parentName?: string | null;
  parentPhone?: string | null;
  parentEmail?: string | null;
  projectName?: string | null;
  source?: string | null;
  sheetRow?: number | null;
  groupRequestId?: string | null;
  supabaseGroupId?: string | null;
  inviteLink?: string | null;
  payload: unknown;
  stage?: CaseStage;
  /** Both null for a pre-join case; handover fills them in. */
  slackChannel?: string | null;
  slackThreadTs?: string | null;
}

export async function insertCase(input: NewCase): Promise<GroupCase> {
  const rows = await call<GroupCaseRow[]>('POST', '/group_cases', {
    body: {
      chat_id: input.chatId,
      group_name: input.groupName,
      student_name: input.studentName,
      student_phone: input.studentPhone ?? null,
      student_email: input.studentEmail ?? null,
      parent_name: input.parentName ?? null,
      parent_phone: input.parentPhone ?? null,
      parent_email: input.parentEmail ?? null,
      project_name: input.projectName ?? null,
      source: input.source ?? null,
      sheet_row: input.sheetRow ?? null,
      group_request_id: input.groupRequestId ?? null,
      supabase_group_id: input.supabaseGroupId ?? null,
      invite_link: input.inviteLink ?? null,
      payload: input.payload ?? {},
      ...(input.stage ? { stage: input.stage } : {}),
      slack_channel: input.slackChannel ?? null,
      slack_thread_ts: input.slackThreadTs ?? null,
    },
    prefer: 'return=representation',
  });

  const row = rows[0];
  if (!row) throw new DbError('group_cases insert returned no row', 500, rows);
  return toCase(row);
}

export interface CasePatch {
  groupName?: string;
  studentName?: string;
  studentPhone?: string | null;
  studentEmail?: string | null;
  parentName?: string | null;
  parentPhone?: string | null;
  parentEmail?: string | null;
  projectName?: string | null;
  supabaseGroupId?: string | null;
  inviteLink?: string | null;
  payload?: unknown;
  stage?: CaseStage;
  mentorName?: string | null;
  mentorRequestedName?: string | null;
  mentorIntroSentAt?: Date | null;
  mentorSyncUserId?: string | null;
  pendingMentorName?: string | null;
  pendingMentorVariant?: string | null;
  pendingMentorSince?: Date | null;
  mentorJoinedAt?: Date | null;
  firstClassConfirmedAt?: Date | null;
  firstClassConfirmedReason?: string | null;
  firstClassFirstPromptedAt?: Date | null;
  firstClassPromptedAt?: Date | null;
  firstClassPromptCount?: number;
  firstClassEscalatedAt?: Date | null;
  /** Written once, when handover opens the thread for a pre-join case. */
  slackChannel?: string | null;
  slackThreadTs?: string | null;
  lastNudgedAt?: Date | null;
  nudgeCount?: number;
}

/**
 * PostgREST has no equivalent of Prisma's `@updatedAt`, and a trigger would be
 * invisible from here, so updated_at is written on every patch instead.
 */
export async function updateCase(
  id: string,
  patch: CasePatch
): Promise<GroupCase> {
  const body: Record<string, unknown> = { updated_at: new Date().toISOString() };

  const set = (column: string, value: unknown) => {
    if (value !== undefined) {
      body[column] = value instanceof Date ? value.toISOString() : value;
    }
  };

  set('group_name', patch.groupName);
  set('student_name', patch.studentName);
  set('student_phone', patch.studentPhone);
  set('student_email', patch.studentEmail);
  set('parent_name', patch.parentName);
  set('parent_phone', patch.parentPhone);
  set('parent_email', patch.parentEmail);
  set('project_name', patch.projectName);
  set('supabase_group_id', patch.supabaseGroupId);
  set('invite_link', patch.inviteLink);
  set('payload', patch.payload);
  set('stage', patch.stage);
  set('mentor_name', patch.mentorName);
  set('mentor_requested_name', patch.mentorRequestedName);
  set('mentor_intro_sent_at', patch.mentorIntroSentAt);
  set('mentor_sync_user_id', patch.mentorSyncUserId);
  set('pending_mentor_name', patch.pendingMentorName);
  set('pending_mentor_variant', patch.pendingMentorVariant);
  set('pending_mentor_since', patch.pendingMentorSince);
  set('mentor_joined_at', patch.mentorJoinedAt);
  set('first_class_confirmed_at', patch.firstClassConfirmedAt);
  set('first_class_confirmed_reason', patch.firstClassConfirmedReason);
  set('first_class_first_prompted_at', patch.firstClassFirstPromptedAt);
  set('first_class_prompted_at', patch.firstClassPromptedAt);
  set('first_class_prompt_count', patch.firstClassPromptCount);
  set('first_class_escalated_at', patch.firstClassEscalatedAt);
  set('slack_channel', patch.slackChannel);
  set('slack_thread_ts', patch.slackThreadTs);
  set('last_nudged_at', patch.lastNudgedAt);
  set('nudge_count', patch.nudgeCount);

  const rows = await call<GroupCaseRow[]>(
    'PATCH',
    `/group_cases?id=eq.${encodeURIComponent(id)}`,
    { body, prefer: 'return=representation' }
  );

  const row = rows[0];
  if (!row) throw new DbError(`group_cases ${id} not found`, 404, rows);
  return toCase(row);
}

export interface NewAction {
  caseId: string;
  kind: ActionKind;
  /** Human-readable description of what was asked for, for the audit trail. */
  command: string;
  actor?: string | null;
  /**
   * Supplied by the dashboard, one per confirmed dialog. Omit and the action
   * is always inserted -- only pass it when a repeat must be suppressed.
   */
  idempotencyKey?: string | null;
}

/**
 * Claim an action, or find that the same one was already claimed.
 *
 * Returns null when the idempotency key is already on file. ON CONFLICT DO
 * NOTHING makes the check and the insert a single statement, so a double-click
 * or a retried request can't get two sends through -- which a read-then-insert
 * would allow. Without a key there is nothing to collide on and the insert
 * always succeeds.
 */
export async function claimAction(input: NewAction): Promise<CaseAction | null> {
  const body = {
    case_id: input.caseId,
    kind: input.kind,
    command: input.command,
    actor: input.actor ?? null,
    idempotency_key: input.idempotencyKey ?? null,
    status: 'PENDING' satisfies ActionStatus,
  };

  const rows = await call<CaseActionRow[]>(
    'POST',
    input.idempotencyKey
      ? '/case_actions?on_conflict=idempotency_key'
      : '/case_actions',
    {
      body,
      prefer: input.idempotencyKey
        ? 'return=representation,resolution=ignore-duplicates'
        : 'return=representation',
    }
  );

  return rows[0] ? toAction(rows[0]) : null;
}

/** The already-recorded action for an idempotency key, for replaying a result. */
export async function findActionByKey(key: string): Promise<CaseAction | null> {
  const params = new URLSearchParams({
    select: '*',
    idempotency_key: `eq.${key}`,
    limit: '1',
  });
  const rows = await call<CaseActionRow[]>('GET', `/case_actions?${params}`);
  return rows[0] ? toAction(rows[0]) : null;
}

export async function updateAction(
  id: string,
  patch: { status?: ActionStatus; detail?: unknown; error?: string | null }
): Promise<void> {
  const body: Record<string, unknown> = {};
  if (patch.status !== undefined) body.status = patch.status;
  if (patch.detail !== undefined) body.detail = patch.detail;
  if (patch.error !== undefined) body.error = patch.error;
  if (Object.keys(body).length === 0) return;

  await call('PATCH', `/case_actions?id=eq.${encodeURIComponent(id)}`, {
    body,
    prefer: 'return=minimal',
  });
}

// ---------------------------------------------------------------------------
// project_setups -- Stage 5 details entered from the dashboard.
//
// This table is owned by the project-setup service (its
// sql/001_project_setup.sql). The dashboard writes only the top half here --
// the title, description, curriculum subject and the submitted_at gate -- and
// reads the rest back to show progress. The step statuses and the Drive folder
// are owned by that service's cron and are never written from here.

export interface ProjectSetup {
  caseId: string;
  projectTitle: string | null;
  projectDescription: string | null;
  curriculumSubject: string | null;
  submittedAt: Date | null;
  submittedBy: string | null;
  status: string;
  stepWhatsapp: string;
  stepWhatsappDriveLink: string;
  stepSync: string;
  stepDrive: string;
  stepMentorAccess: string;
  stepCurriculum: string;
  stepCosmicStudent: string;
  stepCosmicProject: string;
  stepCosmicSyncGroup: string;
  driveFolderId: string | null;
  driveFolderUrl: string | null;
  cosmicStudentId: string | null;
  cosmicProjectId: string | null;
  lastError: string | null;
  /** What the intake sheet last held, so an edit there can be spotted. */
  sheetDetailsSeen: SheetDetails | null;
  detailsRevision: number;
  appliedRevision: number;
}

/** The pair of fields either writer can change. */
export interface SheetDetails {
  title: string;
  description: string;
}

interface ProjectSetupRow {
  case_id: string;
  project_title: string | null;
  project_description: string | null;
  curriculum_subject: string | null;
  submitted_at: string | null;
  submitted_by: string | null;
  status: string;
  step_whatsapp: string;
  step_whatsapp_drive_link: string;
  step_sync: string;
  step_drive: string;
  step_mentor_access: string;
  step_curriculum: string;
  step_cosmic_student: string;
  step_cosmic_project: string;
  step_cosmic_sync_group: string;
  drive_folder_id: string | null;
  drive_folder_url: string | null;
  cosmic_student_id: string | null;
  cosmic_project_id: string | null;
  last_error: string | null;
  sheet_details_seen: SheetDetails | null;
  details_revision: number;
  applied_revision: number;
}

function toProjectSetup(row: ProjectSetupRow): ProjectSetup {
  return {
    caseId: row.case_id,
    projectTitle: row.project_title,
    projectDescription: row.project_description,
    curriculumSubject: row.curriculum_subject,
    submittedAt: date(row.submitted_at),
    submittedBy: row.submitted_by,
    status: row.status,
    stepWhatsapp: row.step_whatsapp,
    stepWhatsappDriveLink: row.step_whatsapp_drive_link,
    stepSync: row.step_sync,
    stepDrive: row.step_drive,
    stepMentorAccess: row.step_mentor_access,
    stepCurriculum: row.step_curriculum,
    stepCosmicStudent: row.step_cosmic_student,
    stepCosmicProject: row.step_cosmic_project,
    stepCosmicSyncGroup: row.step_cosmic_sync_group,
    driveFolderId: row.drive_folder_id,
    driveFolderUrl: row.drive_folder_url,
    cosmicStudentId: row.cosmic_student_id,
    cosmicProjectId: row.cosmic_project_id,
    lastError: row.last_error,
    sheetDetailsSeen: row.sheet_details_seen,
    detailsRevision: row.details_revision,
    appliedRevision: row.applied_revision,
  };
}

export async function findProjectSetup(
  caseId: string
): Promise<ProjectSetup | null> {
  const params = new URLSearchParams({
    select: '*',
    case_id: `eq.${caseId}`,
    limit: '1',
  });
  const rows = await call<ProjectSetupRow[]>('GET', `/project_setups?${params}`);
  return rows[0] ? toProjectSetup(rows[0]) : null;
}

export interface ProjectSetupInput {
  projectTitle: string;
  projectDescription: string | null;
  curriculumSubject: string | null;
  submittedBy: string | null;
}

/** Compare the two fields the sheet and the dashboard both write. */
function detailsDiffer(
  a: { title: string | null; description: string | null },
  b: { title: string | null; description: string | null }
): boolean {
  return (a.title ?? '') !== (b.title ?? '') ||
    (a.description ?? '') !== (b.description ?? '');
}

/**
 * Upsert the dashboard-owned fields and (re)set the submitted_at gate that
 * makes the case eligible for the setup cron.
 *
 * merge-duplicates updates only the columns sent here, so a re-submit leaves
 * the cron's own columns (status, per-step outcomes, the created Drive folder)
 * untouched -- editing details never silently re-copies a curriculum. A row
 * that already FAILED stays FAILED and is picked up again on the next tick,
 * now with the corrected details.
 */
export async function upsertProjectSetup(
  caseId: string,
  input: ProjectSetupInput
): Promise<ProjectSetup> {
  const now = new Date().toISOString();

  // A changed title or description re-opens the WhatsApp step on a case that
  // has already run, so the group name and description follow the correction
  // instead of being stranded at whatever the first submission said. Read
  // first: PostgREST has no atomic increment, and both writers of this column
  // (here and the sheet cron) move at human pace on a single replica.
  const existing = await findProjectSetup(caseId);
  const changed =
    !existing ||
    detailsDiffer(
      { title: existing.projectTitle, description: existing.projectDescription },
      { title: input.projectTitle, description: input.projectDescription }
    );
  const revision = (existing?.detailsRevision ?? 0) + (changed ? 1 : 0);

  // A case that already finished is not in the setup cron's working set, so an
  // edit to a completed project would otherwise never reach the WhatsApp
  // group. Re-opening it puts it back in the queue, where the revision it has
  // already applied tells it to redo the group name and description and
  // nothing else. RUNNING is left alone -- a pass is mid-flight, and the next
  // one picks the change up.
  const reopen = changed && existing?.status === 'DONE';

  const rows = await call<ProjectSetupRow[]>(
    'POST',
    '/project_setups?on_conflict=case_id',
    {
      body: {
        case_id: caseId,
        project_title: input.projectTitle,
        project_description: input.projectDescription,
        curriculum_subject: input.curriculumSubject,
        submitted_by: input.submittedBy,
        submitted_at: now,
        details_revision: revision,
        ...(reopen ? { status: 'PENDING', completed_at: null, attempts: 0 } : {}),
        updated_at: now,
      },
      prefer: 'return=representation,resolution=merge-duplicates',
    }
  );
  const row = rows[0];
  if (!row) throw new DbError('project_setups upsert returned no row', 500, rows);
  return toProjectSetup(row);
}

/**
 * Record what the intake sheet now holds for a case.
 *
 * Only ever called once a write to the sheet has actually landed. If the
 * mirror-write fails, this is deliberately skipped: the sheet still holds the
 * old text, so leaving the stored copy alone keeps the two agreeing and stops
 * the next sync pass reading that stale text back over the new details.
 */
export async function markSheetDetailsSeen(
  caseId: string,
  seen: SheetDetails
): Promise<void> {
  await call('PATCH', `/project_setups?case_id=eq.${encodeURIComponent(caseId)}`, {
    body: { sheet_details_seen: seen, updated_at: new Date().toISOString() },
    prefer: 'return=minimal',
  });
}

/**
 * Record the Drive folder made at intake against a case.
 *
 * Creates the project_setups row if the case doesn't have one yet -- at
 * registration it never does -- but deliberately does NOT set submitted_at:
 * having a folder is not the same as having project details, and the setup
 * cron must still wait for those. merge-duplicates means an existing row keeps
 * everything else it holds, and a folder already on record is not overwritten
 * by a later replay.
 */
export async function recordDriveFolder(
  caseId: string,
  folder: { driveFolderId: string; driveFolderUrl: string | null }
): Promise<void> {
  const existing = await findProjectSetup(caseId);
  if (existing?.driveFolderUrl) return; // already knows a folder -- leave it

  const now = new Date().toISOString();
  await call('POST', '/project_setups?on_conflict=case_id', {
    body: {
      case_id: caseId,
      drive_folder_id: folder.driveFolderId,
      drive_folder_url: folder.driveFolderUrl,
      updated_at: now,
    },
    prefer: 'return=minimal,resolution=merge-duplicates',
  });
}

export interface SheetSyncCase {
  caseId: string;
  sheetRow: number;
  groupName: string;
  /** The three things that say whether a mentor has already been dealt with. */
  stage: CaseStage;
  mentorName: string | null;
  mentorIntroSentAt: Date | null;
  /** Null when the case has no project_setups row yet. */
  setup: ProjectSetup | null;
}

/**
 * Every case that came from a sheet row, with its setup row if it has one.
 *
 * One request with a left embed, so a case whose details have never been
 * entered still comes back (with setup null) and can be created from the sheet.
 */
export async function listCasesForSheetSync(): Promise<SheetSyncCase[]> {
  const params = new URLSearchParams({
    select:
      'id,sheet_row,group_name,stage,mentor_name,mentor_intro_sent_at,project_setups(*)',
    sheet_row: 'not.is.null',
  });
  const rows = await call<
    {
      id: string;
      sheet_row: number;
      group_name: string;
      stage: CaseStage;
      mentor_name: string | null;
      mentor_intro_sent_at: string | null;
      project_setups: ProjectSetupRow | ProjectSetupRow[] | null;
    }[]
  >('GET', `/group_cases?${params}`);

  return rows.map((row) => {
    // A one-to-one embed comes back as an object, but PostgREST returns an
    // array when it reads the relationship the other way round -- accept both.
    const embedded = Array.isArray(row.project_setups)
      ? row.project_setups[0] ?? null
      : row.project_setups;
    return {
      caseId: row.id,
      sheetRow: row.sheet_row,
      groupName: row.group_name,
      stage: row.stage,
      mentorName: row.mentor_name,
      mentorIntroSentAt: date(row.mentor_intro_sent_at),
      setup: embedded ? toProjectSetup(embedded) : null,
    };
  });
}

export interface SheetDetailsPatch {
  projectTitle: string;
  projectDescription: string | null;
  /** Set only when the sheet row is complete enough to make the case eligible. */
  submit: boolean;
  seen: SheetDetails;
  revision: number;
  /** True when the case had already finished -- see upsertProjectSetup. */
  reopen?: boolean;
}

/**
 * Apply an edit made in the sheet, and record the sheet values that produced
 * it in the same write -- the two must not be able to drift apart.
 *
 * curriculum_subject is never touched here: it is only ever chosen in the
 * dashboard, and a sheet edit must not clear it.
 */
export async function applySheetDetails(
  caseId: string,
  patch: SheetDetailsPatch
): Promise<ProjectSetup> {
  const now = new Date().toISOString();
  const rows = await call<ProjectSetupRow[]>(
    'POST',
    '/project_setups?on_conflict=case_id',
    {
      body: {
        case_id: caseId,
        project_title: patch.projectTitle,
        project_description: patch.projectDescription,
        sheet_details_seen: patch.seen,
        details_revision: patch.revision,
        ...(patch.submit ? { submitted_at: now, submitted_by: 'intake sheet' } : {}),
        ...(patch.reopen ? { status: 'PENDING', completed_at: null, attempts: 0 } : {}),
        updated_at: now,
      },
      prefer: 'return=representation,resolution=merge-duplicates',
    }
  );
  const row = rows[0];
  if (!row) throw new DbError('project_setups sheet sync returned no row', 500, rows);
  return toProjectSetup(row);
}

// ---------------------------------------------------------------------------
// mentors -- dashboard-added entries, merged with the JSON seed in mentors.ts.

export interface DbMentor {
  id: string;
  name: string;
  intro: string;
  variants: Record<string, string> | null;
  email: string | null;
  phone: string | null;
  /** Their SYNC users.id; null until the SYNC account has been made. */
  syncUserId: string | null;
  /** Why the last attempt to make it failed, for the backfill and the UI. */
  syncError: string | null;
  createdAt: Date;
}

interface DbMentorRow {
  id: string;
  name: string;
  intro: string;
  variants: Record<string, string> | null;
  email: string | null;
  phone: string | null;
  sync_user_id: string | null;
  sync_error: string | null;
  created_at: string;
}

function toMentor(row: DbMentorRow): DbMentor {
  return {
    id: row.id,
    name: row.name,
    intro: row.intro,
    variants: row.variants,
    email: row.email,
    phone: row.phone,
    syncUserId: row.sync_user_id,
    syncError: row.sync_error,
    createdAt: new Date(row.created_at),
  };
}

export async function listDbMentors(): Promise<DbMentor[]> {
  const params = new URLSearchParams({ select: '*', order: 'created_at.desc' });
  const rows = await call<DbMentorRow[]>('GET', `/mentors?${params}`);
  return rows.map(toMentor);
}

export interface NewMentor {
  name: string;
  intro: string;
  variants?: Record<string, string> | null;
  email?: string | null;
  phone?: string | null;
  createdBy?: string | null;
}

/**
 * Insert a mentor. A duplicate name violates the case-insensitive unique index
 * and comes back as a 409 from PostgREST, which surfaces as a DbError the API
 * layer turns into a friendly "already exists".
 */
export async function insertMentor(input: NewMentor): Promise<DbMentor> {
  const rows = await call<DbMentorRow[]>('POST', '/mentors', {
    body: {
      name: input.name,
      intro: input.intro,
      variants: input.variants ?? null,
      email: input.email ?? null,
      phone: input.phone ?? null,
      created_by: input.createdBy ?? null,
    },
    prefer: 'return=representation',
  });
  const row = rows[0];
  if (!row) throw new DbError('mentors insert returned no row', 500, rows);
  return toMentor(row);
}

/**
 * The dashboard-added row for this name, or null when the name only exists in
 * the JSON seed. Matched in memory rather than with a PostgREST filter: the
 * table is small, and a name is free text that would otherwise have to be
 * escaped against `ilike`'s wildcards.
 */
export async function findDbMentorByName(name: string): Promise<DbMentor | null> {
  const wanted = name.trim().toLowerCase();
  const rows = await listDbMentors();
  return rows.find((m) => m.name.trim().toLowerCase() === wanted) ?? null;
}

/** Change a mentor's introduction, leaving the rest of the row alone. */
export async function updateMentorIntro(id: string, intro: string): Promise<DbMentor> {
  const rows = await call<DbMentorRow[]>('PATCH', `/mentors?id=eq.${encodeURIComponent(id)}`, {
    body: { intro, updated_at: new Date().toISOString() },
    prefer: 'return=representation',
  });
  const row = rows[0];
  if (!row) throw new DbError('mentors update returned no row', 500, rows);
  return toMentor(row);
}

/**
 * Fill in a mentor's contact details from SYNC.
 *
 * Only the fields given are written, and each is left alone when it is already
 * set here: our copy is the one the dashboard edits, so a backfill pulling from
 * SYNC must not overwrite it. Used by the phone backfill (mentor-phone-backfill).
 */
export async function updateMentorContact(
  id: string,
  patch: { phone?: string | null; email?: string | null; syncUserId?: string | null }
): Promise<DbMentor> {
  const body: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (patch.phone !== undefined) body.phone = patch.phone;
  if (patch.email !== undefined) body.email = patch.email;
  if (patch.syncUserId !== undefined) {
    body.sync_user_id = patch.syncUserId;
    body.sync_error = null;
  }
  const rows = await call<DbMentorRow[]>('PATCH', `/mentors?id=eq.${encodeURIComponent(id)}`, {
    body,
    prefer: 'return=representation',
  });
  const row = rows[0];
  if (!row) throw new DbError('mentors contact update returned no row', 500, rows);
  return toMentor(row);
}

/**
 * Mentors whose SYNC account still hasn't been made -- the backfill's working
 * set. SYNC being down when a mentor is added must not block adding them, so
 * the account is retried here instead.
 */
export async function listMentorsAwaitingSync(): Promise<DbMentor[]> {
  const params = new URLSearchParams({
    select: '*',
    sync_user_id: 'is.null',
    // A row with no phone number can never get a SYNC account (it is what the
    // account is keyed on), so it is not work -- editing a seed mentor's intro
    // writes such a row, and it would otherwise be retried on every pass.
    phone: 'not.is.null',
    order: 'created_at.asc',
  });
  const rows = await call<DbMentorRow[]>('GET', `/mentors?${params}`);
  return rows.map(toMentor);
}

/** Record the outcome of making a mentor's SYNC account. */
export async function updateMentorSync(
  id: string,
  patch: { syncUserId?: string | null; syncError?: string | null }
): Promise<void> {
  const body: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (patch.syncUserId !== undefined) body.sync_user_id = patch.syncUserId;
  if (patch.syncError !== undefined) body.sync_error = patch.syncError;
  await call('PATCH', `/mentors?id=eq.${encodeURIComponent(id)}`, {
    body,
    prefer: 'return=minimal',
  });
}

// ---------------------------------------------------------------------------
// queued_actions -- follow-up lined up before the family has joined.

export type QueuedStatus = 'QUEUED' | 'SENT' | 'FAILED' | 'CANCELLED';

export interface QueuedAction {
  id: string;
  caseId: string;
  position: number;
  kind: ActionKind;
  params: Record<string, unknown>;
  status: QueuedStatus;
  caseActionId: string | null;
  queuedBy: string | null;
  error: string | null;
  attempts: number;
  sentAt: Date | null;
  createdAt: Date;
}

interface QueuedActionRow {
  id: string;
  case_id: string;
  position: number;
  kind: ActionKind;
  params: Record<string, unknown> | null;
  status: QueuedStatus;
  case_action_id: string | null;
  queued_by: string | null;
  error: string | null;
  attempts: number;
  sent_at: string | null;
  created_at: string;
}

function toQueued(row: QueuedActionRow): QueuedAction {
  return {
    id: row.id,
    caseId: row.case_id,
    position: row.position,
    kind: row.kind,
    params: row.params ?? {},
    status: row.status,
    caseActionId: row.case_action_id,
    queuedBy: row.queued_by,
    error: row.error,
    attempts: row.attempts,
    sentAt: date(row.sent_at),
    createdAt: new Date(row.created_at),
  };
}

/** Everything queued for one case, in the order it will run. */
export async function listQueuedForCase(caseId: string): Promise<QueuedAction[]> {
  const params = new URLSearchParams({
    select: '*',
    case_id: `eq.${caseId}`,
    order: 'position.asc,created_at.asc',
  });
  const rows = await call<QueuedActionRow[]>('GET', `/queued_actions?${params}`);
  return rows.map(toQueued);
}

export interface NewQueuedAction {
  kind: ActionKind;
  params: Record<string, unknown>;
  queuedBy?: string | null;
}

/**
 * Add one action to the end of a case's queue.
 *
 * The position is read then written rather than computed in SQL: PostgREST has
 * no expression inserts, the dashboard is the only writer, and two people
 * queuing on the same case in the same instant would at worst produce two rows
 * with the same position -- which the created_at tiebreak in the ordering
 * already handles.
 */
export async function enqueueAction(
  caseId: string,
  input: NewQueuedAction
): Promise<QueuedAction> {
  const existing = await listQueuedForCase(caseId);
  const position = existing.reduce((max, a) => Math.max(max, a.position), 0) + 1;

  const rows = await call<QueuedActionRow[]>('POST', '/queued_actions', {
    body: {
      case_id: caseId,
      position,
      kind: input.kind,
      params: input.params,
      queued_by: input.queuedBy ?? null,
    },
    prefer: 'return=representation',
  });
  const row = rows[0];
  if (!row) throw new DbError('queued_actions insert returned no row', 500, rows);
  return toQueued(row);
}

/**
 * Cases with something still queued, and which are past AWAITING_JOIN -- the
 * runner's working set. The embedded stage filter does the gating in one query
 * rather than fetching every queue and discarding most of them.
 */
export async function listCasesWithQueue(): Promise<string[]> {
  const params = new URLSearchParams();
  params.set('select', 'case_id,group_cases!inner(stage)');
  params.set('status', 'eq.QUEUED');
  params.set('group_cases.stage', 'neq.AWAITING_JOIN');
  params.set('order', 'position.asc');

  const rows = await call<{ case_id: string }[]>('GET', `/queued_actions?${params}`);
  return [...new Set(rows.map((r) => r.case_id))];
}

/**
 * Cases that already have an ADD_MENTOR row of any status.
 *
 * One request for the whole set, because the sheet intake asks this of every
 * case it looks at. Status is deliberately not filtered: a mentor introduction
 * that was queued and then cancelled, or that failed, was a decision someone
 * made, and the sheet must not quietly queue a second one behind it.
 */
export async function listCaseIdsWithMentorQueued(): Promise<Set<string>> {
  const params = new URLSearchParams({
    select: 'case_id',
    kind: 'eq.ADD_MENTOR',
  });
  const rows = await call<{ case_id: string }[]>('GET', `/queued_actions?${params}`);
  return new Set(rows.map((r) => r.case_id));
}

export interface QueuedPatch {
  status?: QueuedStatus;
  caseActionId?: string | null;
  error?: string | null;
  attempts?: number;
  sentAt?: Date | null;
}

export async function updateQueuedAction(
  id: string,
  patch: QueuedPatch
): Promise<QueuedAction> {
  const body: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (patch.status !== undefined) body.status = patch.status;
  if (patch.caseActionId !== undefined) body.case_action_id = patch.caseActionId;
  if (patch.error !== undefined) body.error = patch.error;
  if (patch.attempts !== undefined) body.attempts = patch.attempts;
  if (patch.sentAt !== undefined) body.sent_at = patch.sentAt?.toISOString() ?? null;

  const rows = await call<QueuedActionRow[]>(
    'PATCH',
    `/queued_actions?id=eq.${encodeURIComponent(id)}`,
    { body, prefer: 'return=representation' }
  );
  const row = rows[0];
  if (!row) throw new DbError(`queued_actions ${id} not found`, 404, rows);
  return toQueued(row);
}

/**
 * Claim a queued action for sending: QUEUED -> SENT is not it -- the send has
 * to happen first -- so this flips it out of QUEUED by bumping attempts under
 * a status filter, which is the compare-and-set that stops two ticks running
 * the same row. Returns null when someone else got there first.
 */
export async function claimQueuedAction(id: string, attempts: number): Promise<QueuedAction | null> {
  const rows = await call<QueuedActionRow[]>(
    'PATCH',
    `/queued_actions?id=eq.${encodeURIComponent(id)}&status=eq.QUEUED&attempts=eq.${attempts}`,
    {
      body: { attempts: attempts + 1, updated_at: new Date().toISOString() },
      prefer: 'return=representation',
    }
  );
  return rows[0] ? toQueued(rows[0]) : null;
}

/** Remove a queued action that hasn't run. Sent ones are history, not queue. */
export async function cancelQueuedAction(caseId: string, id: string): Promise<boolean> {
  const rows = await call<QueuedActionRow[]>(
    'PATCH',
    `/queued_actions?id=eq.${encodeURIComponent(id)}&case_id=eq.${encodeURIComponent(caseId)}&status=eq.QUEUED`,
    { body: { status: 'CANCELLED', updated_at: new Date().toISOString() }, prefer: 'return=representation' }
  );
  return rows.length > 0;
}

// ---------------------------------------------------------------------------
// Assessment completions -- which (case, assessment) pairs have been submitted
// (their email showed up in the response sheet) and announced in Slack.

export type AssessmentKind = 'CS_ASSESSMENT' | 'PROTOTYPING_ASSESSMENT';

export interface SentAssessment {
  caseId: string;
  kind: AssessmentKind;
  sentAt: Date;
}

/**
 * The assessments that were actually sent (action status OK) on or after
 * `since` -- the working set the completion cron checks. Newest first.
 */
export async function listSentAssessments(since: Date): Promise<SentAssessment[]> {
  const params = new URLSearchParams({
    select: 'case_id,kind,created_at',
    kind: 'in.(CS_ASSESSMENT,PROTOTYPING_ASSESSMENT)',
    status: 'eq.OK',
    created_at: `gte.${since.toISOString()}`,
    order: 'created_at.desc',
  });
  const rows = await call<
    { case_id: string; kind: AssessmentKind; created_at: string }[]
  >('GET', `/case_actions?${params}`);
  return rows.map((r) => ({
    caseId: r.case_id,
    kind: r.kind,
    sentAt: new Date(r.created_at),
  }));
}

/** The (case_id|kind) pairs already recorded as completed, for a quick lookup. */
export async function listCompletedAssessmentKeys(): Promise<Set<string>> {
  const rows = await call<{ case_id: string; kind: AssessmentKind }[]>(
    'GET',
    '/assessment_completions?select=case_id,kind'
  );
  return new Set(rows.map((r) => `${r.case_id}|${r.kind}`));
}

/**
 * Record a completion. Returns true only when this is the first time (the row
 * was inserted), so the caller announces it in Slack exactly once. A second
 * call for the same (case, kind) hits the primary key and is ignored.
 */
export async function recordAssessmentCompletion(
  caseId: string,
  kind: AssessmentKind,
  studentEmail: string | null
): Promise<boolean> {
  const rows = await call<{ case_id: string }[]>(
    'POST',
    '/assessment_completions?on_conflict=case_id,kind',
    {
      body: { case_id: caseId, kind, student_email: studentEmail },
      prefer: 'return=representation,resolution=ignore-duplicates',
    }
  );
  return rows.length > 0;
}

/** Cheapest query that proves the API, the key and the tables all work. */
export async function ping(): Promise<void> {
  await call('GET', '/group_cases?select=id&limit=1');
}
