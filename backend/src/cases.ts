import { config } from './config';
import * as db from './db';
import type { GroupCase } from './db';
import * as periskope from './periskope';
import * as slack from './slack';
import * as templates from './templates';
import { parseDeadline } from './dates';
import { findMentor, introFor, type Mentor } from './mentors';
import { findHost, hosts } from './booking';
import * as sync from './sync';
import * as sheets from './sheets';

/**
 * The case lifecycle: a group arrives, Slack is asked what to do with it, and
 * every reply in that thread turns into a WhatsApp message.
 */

export interface IntakeInput {
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
}

function summarise(c: GroupCase): templates.CaseSummary {
  return {
    caseId: c.id,
    groupName: c.groupName,
    studentName: c.studentName,
    studentPhone: c.studentPhone,
    studentEmail: c.studentEmail,
    parentName: c.parentName,
    parentPhone: c.parentPhone,
    projectName: c.projectName,
    chatId: c.chatId,
    source: c.source,
    sheetRow: c.sheetRow,
    inviteLink: c.inviteLink,
  };
}

export interface OpenCaseResult {
  case: GroupCase;
  created: boolean;
}

/** The fields a replayed or upgraded intake refreshes on an existing case. */
function refreshedFields(input: IntakeInput, existing: GroupCase) {
  return {
    groupName: input.groupName,
    studentName: input.studentName,
    studentPhone: input.studentPhone ?? existing.studentPhone,
    studentEmail: input.studentEmail ?? existing.studentEmail,
    parentName: input.parentName ?? existing.parentName,
    parentPhone: input.parentPhone ?? existing.parentPhone,
    parentEmail: input.parentEmail ?? existing.parentEmail,
    projectName: input.projectName ?? existing.projectName,
    inviteLink: input.inviteLink ?? existing.inviteLink,
    supabaseGroupId: input.supabaseGroupId ?? existing.supabaseGroupId,
    payload: input.payload,
  };
}

function summaryOf(input: IntakeInput): templates.CaseSummary {
  return {
    groupName: input.groupName,
    studentName: input.studentName,
    studentPhone: input.studentPhone,
    studentEmail: input.studentEmail,
    parentName: input.parentName,
    parentPhone: input.parentPhone,
    projectName: input.projectName,
    chatId: input.chatId,
    source: input.source,
    sheetRow: input.sheetRow,
    inviteLink: input.inviteLink,
  };
}

/**
 * Record a group the moment it exists, before the family has joined it.
 *
 * This is what puts a project on the dashboard early: the case carries the
 * student, the sheet row and the project name from intake, so the title and
 * description can be filled in (from either the dashboard or the sheet) while
 * everyone is still holding an invite link.
 *
 * No Slack thread is opened here -- there is nothing to decide yet, and the
 * team shouldn't be asked about a group nobody has joined. The case sits at
 * AWAITING_JOIN, out of the nudge rotation, until openCase() upgrades it.
 */
export async function registerCase(input: IntakeInput): Promise<OpenCaseResult> {
  const existing = await db.findCaseByChatId(input.chatId);
  if (existing) {
    const refreshed = await db.updateCase(existing.id, refreshedFields(input, existing));
    return { case: refreshed, created: false };
  }

  const created = await db.insertCase({
    chatId: input.chatId,
    groupName: input.groupName,
    studentName: input.studentName,
    studentPhone: input.studentPhone ?? null,
    studentEmail: input.studentEmail ?? null,
    parentName: input.parentName ?? null,
    parentPhone: input.parentPhone ?? null,
    parentEmail: input.parentEmail ?? null,
    projectName: input.projectName ?? null,
    source: input.source ?? null,
    sheetRow: input.sheetRow ?? null,
    groupRequestId: input.groupRequestId ?? null,
    supabaseGroupId: input.supabaseGroupId ?? null,
    inviteLink: input.inviteLink ?? null,
    payload: input.payload,
    stage: 'AWAITING_JOIN',
  });

  console.log(`[${created.id}] registered "${input.groupName}" (awaiting join)`);
  return { case: created, created: true };
}

/**
 * Open the Slack thread for a group whose family has joined and been welcomed.
 *
 * Three ways in, all of which must end with exactly one thread:
 *  - the case was registered pre-join and has no thread yet -> post and attach;
 *  - the case already has a thread -> a replayed handover, refresh and return;
 *  - no case at all (a group made outside intake) -> create and post.
 *
 * chat_id is unique, so whoever is answering never has to work out which of
 * two identical messages is the live one.
 */
export async function openCase(input: IntakeInput): Promise<OpenCaseResult> {
  const existing = await db.findCaseByChatId(input.chatId);

  if (existing) {
    const refreshed = await db.updateCase(existing.id, refreshedFields(input, existing));

    if (refreshed.slackThreadTs) {
      console.log(`[${refreshed.id}] intake replayed for ${input.chatId}`);
      return { case: refreshed, created: false };
    }

    // Registered before the family joined: this is its first real handover, so
    // the thread is opened now and the case leaves AWAITING_JOIN. Posting
    // before the patch means a failure here leaves the case exactly as it was,
    // for the caller to retry.
    const posted = await slack.postMessage({
      text: templates.newGroupPrompt({ ...summaryOf(input), caseId: refreshed.id }),
    });
    const opened = await db.updateCase(refreshed.id, {
      stage: 'NEW',
      slackChannel: posted.channel,
      slackThreadTs: posted.ts,
    });
    console.log(`[${opened.id}] opened thread for "${input.groupName}" (joined)`);
    return { case: opened, created: true };
  }

  // Post to Slack first: the thread timestamp is the key replies are matched
  // on, and a case without one can never be acted upon. If Slack is down the
  // whole intake fails and the caller retries, which is the outcome we want.
  const posted = await slack.postMessage({
    text: templates.newGroupPrompt(summaryOf(input)),
  });

  const created = await db.insertCase({
    chatId: input.chatId,
    groupName: input.groupName,
    studentName: input.studentName,
    studentPhone: input.studentPhone ?? null,
    studentEmail: input.studentEmail ?? null,
    parentName: input.parentName ?? null,
    parentPhone: input.parentPhone ?? null,
    parentEmail: input.parentEmail ?? null,
    projectName: input.projectName ?? null,
    source: input.source ?? null,
    sheetRow: input.sheetRow ?? null,
    groupRequestId: input.groupRequestId ?? null,
    supabaseGroupId: input.supabaseGroupId ?? null,
    inviteLink: input.inviteLink ?? null,
    payload: input.payload,
    slackChannel: posted.channel,
    slackThreadTs: posted.ts,
  });

  console.log(`[${created.id}] opened case for "${input.groupName}"`);
  return { case: created, created: true };
}

/**
 * One instruction from the dashboard.
 *
 * These map onto what the team can actually do to a group. Each carries only
 * what that action needs, so an assessment can't be requested without a
 * deadline or a mentor without a name.
 */
export type ActionInput =
  | { kind: 'ADD_MENTOR'; mentor: string; variant?: string }
  | { kind: 'CS_ASSESSMENT'; deadline: string }
  | { kind: 'PROTOTYPING_ASSESSMENT'; deadline: string }
  | { kind: 'SCHEDULE_MEETING'; host: string };

export interface PerformInput {
  case: GroupCase;
  action: ActionInput;
  /** Signed-in dashboard user; recorded against the action. */
  actor?: string | null;
  /** One per confirmed dialog. A repeat is ignored rather than re-sent. */
  idempotencyKey?: string | null;
}

export interface PerformResult {
  case: GroupCase;
  action: db.CaseAction;
  /** True when this key had already been carried out and nothing was re-sent. */
  replayed: boolean;
}

/**
 * An instruction that cannot be carried out as asked -- an unknown mentor, an
 * ambiguous name, a host with no booking link. Not a failure of the system, so
 * it surfaces as a 422 with enough detail for the dashboard to explain itself,
 * rather than as a 500.
 */
export class Rejected extends Error {
  details: Record<string, unknown>;

  constructor(message: string, details: Record<string, unknown> = {}) {
    super(message);
    this.name = 'Rejected';
    this.details = details;
  }
}

/** A one-line description of the instruction, kept for the audit trail. */
function describe(action: ActionInput): string {
  switch (action.kind) {
    case 'ADD_MENTOR':
      return `Add mentor: ${action.mentor}${action.variant ? ` (${action.variant})` : ''}`;
    case 'CS_ASSESSMENT':
      return `Send Computer Science assessment, deadline ${action.deadline}`;
    case 'PROTOTYPING_ASSESSMENT':
      return `Send Prototyping assessment, deadline ${action.deadline}`;
    case 'SCHEDULE_MEETING':
      return `Schedule a meeting with ${action.host}`;
  }
}

/**
 * Carry out one action against a group.
 *
 * The row is written before anything is sent, so a crash mid-send leaves
 * evidence rather than silence, and the idempotency key makes a retry safe.
 */
export async function performAction(
  input: PerformInput
): Promise<PerformResult> {
  const { case: groupCase, action } = input;

  const claimed = await db.claimAction({
    caseId: groupCase.id,
    kind: action.kind,
    command: describe(action),
    actor: input.actor ?? null,
    idempotencyKey: input.idempotencyKey ?? null,
  });

  if (!claimed) {
    // The key was already used: this exact instruction has been carried out.
    // Hand back what happened the first time instead of sending again.
    const existing = input.idempotencyKey
      ? await db.findActionByKey(input.idempotencyKey)
      : null;
    const current = (await db.findCaseById(groupCase.id)) ?? groupCase;
    if (!existing) {
      throw new Error('action was claimed by another request but cannot be read back');
    }
    console.log(`[${groupCase.id}] ${action.kind} replayed, nothing re-sent`);
    return { case: current, action: existing, replayed: true };
  }

  try {
    const { detail, updated } = await execute(groupCase, action);
    await db.updateAction(claimed.id, { status: 'OK', detail });
    return {
      case: updated,
      action: { ...claimed, status: 'OK', detail },
      replayed: false,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await db.updateAction(claimed.id, {
      status: 'FAILED',
      error: message.slice(0, 2000),
    });
    console.error(`[${groupCase.id}] ${action.kind} failed:`, err);
    throw err;
  }
}

/**
 * Exactly what an action would send, without sending it.
 *
 * Shares the templates, the config and the same matching as the real send, so
 * the dashboard's preview cannot drift away from what a family receives.
 */
export function renderPreview(
  groupCase: GroupCase,
  action: ActionInput
): string {
  switch (action.kind) {
    case 'ADD_MENTOR': {
      const match = findMentor(action.mentor);
      if (match.status !== 'matched') {
        throw new Rejected(
          `No single mentor matches “${action.mentor}”.`,
          { suggestions: match.candidates.map((c) => c.item.name) }
        );
      }
      return templates.mentorIntroduction(
        introFor(match.best!.item, action.variant)
      );
    }
    case 'CS_ASSESSMENT':
    case 'PROTOTYPING_ASSESSMENT': {
      const ctx = {
        studentName: groupCase.studentName,
        deadline: parseDeadline(action.deadline).text,
      };
      return action.kind === 'CS_ASSESSMENT'
        ? templates.computerScienceAssessment(ctx)
        : templates.prototypingAssessment(ctx);
    }
    case 'SCHEDULE_MEETING': {
      const match = findHost(action.host);
      if (match.status !== 'matched') {
        throw new Rejected(`No booking link for “${action.host}”.`, {
          available: hosts.map((h) => h.name),
        });
      }
      return templates.bookingInvite(match.best!.item);
    }
  }
}

interface Executed {
  detail: Record<string, unknown>;
  updated: GroupCase;
}

function execute(groupCase: GroupCase, action: ActionInput): Promise<Executed> {
  switch (action.kind) {
    case 'ADD_MENTOR':
      return addMentor(groupCase, action);
    case 'CS_ASSESSMENT':
      return sendAssessment(groupCase, action, 'computer science');
    case 'PROTOTYPING_ASSESSMENT':
      return sendAssessment(groupCase, action, 'prototyping');
    case 'SCHEDULE_MEETING':
      return scheduleMeeting(groupCase, action);
  }
}

async function addMentor(
  groupCase: GroupCase,
  action: Extract<ActionInput, { kind: 'ADD_MENTOR' }>
): Promise<Executed> {
  const match = findMentor(action.mentor);

  if (match.status === 'none') {
    throw new Rejected(
      `No mentor in the directory matches \u201c${action.mentor}\u201d.`,
      { suggestions: match.candidates.map((c) => c.item.name) }
    );
  }
  if (match.status === 'ambiguous') {
    throw new Rejected(
      `\u201c${action.mentor}\u201d could be any of several mentors.`,
      { suggestions: match.candidates.map((c) => c.item.name) }
    );
  }

  const mentor = match.best!.item;
  const intro = introFor(mentor, action.variant);

  await periskope.sendMessage(
    groupCase.chatId,
    templates.mentorIntroduction(intro)
  );

  // Resolve the mentor on SYNC before the case is stamped, so the id lands
  // with the rest of the assignment. Everything downstream (the SYNC
  // membership, the mentor's Drive access, the COSMIC mentor match) reads that
  // id rather than re-matching this name against SYNC's spelling of it.
  const resolved = await resolveOnSync(mentor);

  const updated = await db.updateCase(groupCase.id, {
    stage: 'MENTOR_ASSIGNED',
    mentorName: mentor.name,
    mentorRequestedName: action.mentor,
    mentorIntroSentAt: new Date(),
    mentorSyncUserId: resolved.mentor?.id ?? null,
  });

  // Side-effects that follow the introduction: DM the group link to the
  // mentor, link them on SYNC, and record mentor details in the sheet. These
  // are best-effort -- the introduction has already gone out, so a failure here
  // is reported (in the action detail and to Slack) but does not fail the
  // action or undo the send.
  const warnings = await afterMentorIntroduced(updated, mentor.name, resolved);

  return {
    updated,
    detail: {
      mentor: mentor.name,
      requested: action.mentor,
      score: match.best!.score,
      variant: action.variant ?? null,
      ...(warnings.length ? { warnings } : {}),
    },
  };
}

/**
 * After a mentor is introduced: (1) DM the group invite link to the mentor's
 * personal WhatsApp, (2) link the mentor into the SYNC group, (3) write the
 * mentor's name/email/phone into the intake sheet. Never throws -- collects and
 * returns human-readable warnings for whatever couldn't be done.
 */
export interface SyncResolution {
  mentor: sync.ResolvedMentor | null;
  /** Why it couldn't be resolved, if it couldn't. */
  warning: string | null;
}

/**
 * Find the mentor's SYNC account.
 *
 * By id when the mentor was added from the dashboard (which creates the SYNC
 * account and stores its id), falling back to an exact name match for the JSON
 * seed, which predates that. The name path refuses to guess -- linking the
 * wrong mentor is the worst outcome available here.
 */
async function resolveOnSync(mentor: Mentor): Promise<SyncResolution> {
  if (!sync.syncConfigured()) {
    return {
      mentor: null,
      warning: 'SYNC not configured -- invite DM, SYNC link and mentor phone/email skipped.',
    };
  }

  try {
    if (mentor.syncUserId) {
      const user = await sync.findUserById(mentor.syncUserId);
      if (user) {
        return {
          mentor: { id: user.id, name: user.name, phone: user.phone_number, email: user.email },
          warning: null,
        };
      }
      // The stored id no longer resolves (removed on SYNC): fall through to
      // the name match rather than silently doing nothing.
    }

    const res = await sync.resolveMentor(mentor.name);
    if (res.status === 'matched') return { mentor: res.mentor, warning: null };
    if (res.status === 'none') {
      return {
        mentor: null,
        warning: `No SYNC mentor exactly named "${mentor.name}" -- invite DM, SYNC link and mentor phone/email skipped.`,
      };
    }
    return {
      mentor: null,
      warning: `"${mentor.name}" matches ${res.count} SYNC mentors -- SYNC actions skipped.`,
    };
  } catch (err) {
    return { mentor: null, warning: `SYNC mentor lookup failed: ${message(err)}` };
  }
}

async function afterMentorIntroduced(
  groupCase: GroupCase,
  mentorName: string,
  resolution: SyncResolution
): Promise<string[]> {
  const warnings: string[] = [];
  const resolved = resolution.mentor;
  if (resolution.warning) warnings.push(resolution.warning);

  // 1. DM the group invite link to the mentor's phone.
  if (resolved) {
    const digits = (resolved.phone ?? '').replace(/\D/g, '');
    if (!digits) {
      warnings.push('Mentor has no phone in SYNC -- invite DM skipped.');
    } else if (!groupCase.inviteLink) {
      warnings.push('Case has no invite link -- invite DM skipped.');
    } else {
      try {
        await periskope.sendMessage(
          `${digits}@c.us`,
          templates.mentorGroupInvite(groupCase.groupName, groupCase.inviteLink)
        );
      } catch (err) {
        warnings.push(`Sending the invite link to the mentor failed: ${message(err)}`);
      }
    }
  }

  // 2. Link the mentor into the SYNC group.
  if (resolved) {
    try {
      const groupId = await sync.findGroupIdByJid(groupCase.chatId);
      if (!groupId) {
        warnings.push(`No SYNC group for JID ${groupCase.chatId} -- mentor not linked (SYNC hasn't onboarded it yet).`);
      } else {
        await sync.ensureMentorMembership(resolved.id, groupId);
      }
    } catch (err) {
      warnings.push(`Linking the mentor on SYNC failed: ${message(err)}`);
    }
  }

  // 3. Write mentor details into the intake sheet row.
  if (sheets.sheetsConfigured()) {
    if (!groupCase.sheetRow) {
      warnings.push('Case has no sheet_row -- mentor details not written to the sheet.');
    } else {
      const cells: Record<string, string> = { 'Mentor Name': resolved?.name ?? mentorName };
      if (resolved?.email) cells['Mentor Email'] = resolved.email;
      if (resolved?.phone) cells['Mentor Phone Number'] = resolved.phone;
      try {
        const { skippedHeaders } = await sheets.writeRowCells(groupCase.sheetRow, cells);
        if (skippedHeaders.length)
          warnings.push(`Sheet is missing column(s): ${skippedHeaders.join(', ')}.`);
      } catch (err) {
        warnings.push(`Writing mentor details to the sheet failed: ${message(err)}`);
      }
    }
  }

  if (warnings.length) {
    console.warn(`[case ${groupCase.id}] mentor side-effects:`, warnings);
    try {
      await slack.postMessage({
        text:
          `:warning: Mentor introduced for *${groupCase.groupName}*, but some follow-ups need attention:\n` +
          warnings.map((w) => `• ${w}`).join('\n'),
      });
    } catch {
      // Slack is best-effort too; the warnings are already in the action detail.
    }
  }

  return warnings;
}

const message = (err: unknown): string => (err instanceof Error ? err.message : String(err));

async function sendAssessment(
  groupCase: GroupCase,
  action: Extract<
    ActionInput,
    { kind: 'CS_ASSESSMENT' | 'PROTOTYPING_ASSESSMENT' }
  >,
  label: string
): Promise<Executed> {
  // The dashboard sends an ISO date; families should read "25 May 2026".
  const deadline = parseDeadline(action.deadline);
  const ctx = { studentName: groupCase.studentName, deadline: deadline.text };

  const message =
    action.kind === 'CS_ASSESSMENT'
      ? templates.computerScienceAssessment(ctx)
      : templates.prototypingAssessment(ctx);

  await periskope.sendMessage(groupCase.chatId, message);
  const updated = await advance(groupCase);

  return {
    updated,
    detail: { assessment: label, deadline: deadline.text },
  };
}

async function scheduleMeeting(
  groupCase: GroupCase,
  action: Extract<ActionInput, { kind: 'SCHEDULE_MEETING' }>
): Promise<Executed> {
  const match = findHost(action.host);

  if (match.status !== 'matched') {
    throw new Rejected(`No booking link for \u201c${action.host}\u201d.`, {
      available: hosts.map((h) => h.name),
    });
  }

  const host = match.best!.item;
  await periskope.sendMessage(groupCase.chatId, templates.bookingInvite(host));
  const updated = await advance(groupCase);

  return { updated, detail: { host: host.name } };
}

/**
 * Move a case into the nudged state.
 *
 * A case that already has its mentor stays where it is: sending a second
 * assessment afterwards shouldn't restart the daily reminders.
 */
async function advance(groupCase: GroupCase): Promise<GroupCase> {
  if (groupCase.stage === 'MENTOR_ASSIGNED') return groupCase;

  return db.updateCase(groupCase.id, {
    stage: 'IN_PROGRESS',
    // Reopening an abandoned case should give it a fresh run of nudges.
    ...(groupCase.stage === 'ABANDONED'
      ? { nudgeCount: 0, lastNudgedAt: null }
      : {}),
  });
}

/** Exposed for the nudge job, which needs the same summary shape. */
export { summarise };

export const nudgeSettings = config.nudge;
