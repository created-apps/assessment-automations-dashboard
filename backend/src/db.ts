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

export type CaseStage = 'NEW' | 'IN_PROGRESS' | 'MENTOR_ASSIGNED' | 'ABANDONED';

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
  slackChannel: string;
  slackThreadTs: string;
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
  slack_channel: string;
  slack_thread_ts: string;
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

const date = (value: string | null): Date | null =>
  value === null ? null : new Date(value);

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
  slackChannel: string;
  slackThreadTs: string;
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
      slack_channel: input.slackChannel,
      slack_thread_ts: input.slackThreadTs,
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
  stepSync: string;
  stepDrive: string;
  stepCurriculum: string;
  stepCosmicStudent: string;
  stepCosmicProject: string;
  stepCosmicSyncGroup: string;
  driveFolderUrl: string | null;
  cosmicStudentId: string | null;
  cosmicProjectId: string | null;
  lastError: string | null;
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
  step_sync: string;
  step_drive: string;
  step_curriculum: string;
  step_cosmic_student: string;
  step_cosmic_project: string;
  step_cosmic_sync_group: string;
  drive_folder_url: string | null;
  cosmic_student_id: string | null;
  cosmic_project_id: string | null;
  last_error: string | null;
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
    stepSync: row.step_sync,
    stepDrive: row.step_drive,
    stepCurriculum: row.step_curriculum,
    stepCosmicStudent: row.step_cosmic_student,
    stepCosmicProject: row.step_cosmic_project,
    stepCosmicSyncGroup: row.step_cosmic_sync_group,
    driveFolderUrl: row.drive_folder_url,
    cosmicStudentId: row.cosmic_student_id,
    cosmicProjectId: row.cosmic_project_id,
    lastError: row.last_error,
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
        updated_at: now,
      },
      prefer: 'return=representation,resolution=merge-duplicates',
    }
  );
  const row = rows[0];
  if (!row) throw new DbError('project_setups upsert returned no row', 500, rows);
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
  createdAt: Date;
}

interface DbMentorRow {
  id: string;
  name: string;
  intro: string;
  variants: Record<string, string> | null;
  email: string | null;
  phone: string | null;
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

/** Cheapest query that proves the API, the key and the tables all work. */
export async function ping(): Promise<void> {
  await call('GET', '/group_cases?select=id&limit=1');
}
