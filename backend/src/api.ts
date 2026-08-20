import express from 'express';
import { z } from 'zod';
import { config } from './config';
import * as db from './db';
import { allMentors, refreshMentors } from './mentors';
import { hosts } from './booking';
import {
  performAction,
  renderPreview,
  Rejected,
  type ActionInput,
} from './cases';
import { PeriskopeError } from './periskope';
import * as sheets from './sheets';
import { ensureMentorOnSync } from './mentor-sync';

/**
 * The dashboard's API.
 *
 * Shapes here are snake_case and mirror the dashboard's `lib/types.ts` exactly,
 * so its data layer is a straight swap from mock data to fetch. The domain
 * objects are camelCase, so this module is where the two meet -- nothing below
 * it knows about the wire format, and nothing above it knows about the domain.
 *
 * Only the dashboard's own server calls this, with a shared bearer token. It is
 * never reached from a browser, which is why student and parent contact details
 * can be returned in full.
 */

const iso = (d: Date | null): string | null => (d ? d.toISOString() : null);

function toApiCase(c: db.GroupCase) {
  return {
    id: c.id,
    chat_id: c.chatId,
    group_name: c.groupName,
    student_name: c.studentName,
    student_phone: c.studentPhone,
    student_email: c.studentEmail,
    parent_name: c.parentName,
    parent_phone: c.parentPhone,
    parent_email: c.parentEmail,
    project_name: c.projectName,
    source: c.source,
    sheet_row: c.sheetRow,
    invite_link: c.inviteLink,
    stage: c.stage,
    mentor_name: c.mentorName,
    mentor_intro_sent_at: iso(c.mentorIntroSentAt),
    last_nudged_at: iso(c.lastNudgedAt),
    nudge_count: c.nudgeCount,
    created_at: c.createdAt.toISOString(),
    updated_at: c.updatedAt.toISOString(),
  };
}

function toApiAction(a: db.CaseAction) {
  return {
    id: a.id,
    case_id: a.caseId,
    kind: a.kind,
    status: a.status,
    detail: (a.detail ?? null) as Record<string, unknown> | null,
    error: a.error,
    actor: a.actor,
    created_at: a.createdAt.toISOString(),
  };
}

export const api = express.Router();

/** Every route below is for the dashboard server only. */
api.use((req, res, next) => {
  const auth = req.get('authorization') ?? '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (token !== config.dashboard.secret) {
    return res.status(401).json({ error: 'bad or missing token' });
  }
  return next();
});

/** Turn a thrown error into the right status without leaking internals. */
function fail(res: express.Response, err: unknown) {
  if (err instanceof Rejected) {
    // The instruction was understood but cannot be carried out as asked.
    return res.status(422).json({ error: err.message, ...err.details });
  }
  if (err instanceof PeriskopeError) {
    return res.status(502).json({ error: `WhatsApp send failed: ${err.message}` });
  }
  const message = err instanceof Error ? err.message : String(err);
  console.error('api error:', err);
  return res.status(500).json({ error: message });
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

api.get('/cases', async (_req, res) => {
  try {
    const cases = await db.listCases();
    return res.json(cases.map(toApiCase));
  } catch (err) {
    return fail(res, err);
  }
});

/**
 * The list view, with each group's most recent action folded in.
 *
 * Registered before /cases/:id so "summaries" isn't captured as an id. Both
 * tables are fetched once and joined here rather than per row, which would be
 * one request per group.
 */
api.get('/cases/summaries', async (_req, res) => {
  try {
    const [cases, actions] = await Promise.all([
      db.listCases(),
      db.listLatestActions(),
    ]);

    // Actions arrive newest first, so the first sighting of a case is its latest.
    const latest = new Map<string, db.CaseAction>();
    for (const action of actions) {
      if (!latest.has(action.caseId)) latest.set(action.caseId, action);
    }

    return res.json(
      cases.map((c) => {
        const last = latest.get(c.id);
        return {
          ...toApiCase(c),
          last_action_kind: last?.kind ?? null,
          last_action_at: last ? last.createdAt.toISOString() : null,
        };
      })
    );
  } catch (err) {
    return fail(res, err);
  }
});

api.get('/cases/:id', async (req, res) => {
  try {
    const found = await db.findCaseById(req.params.id);
    if (!found) return res.status(404).json({ error: 'case not found' });
    return res.json(toApiCase(found));
  } catch (err) {
    return fail(res, err);
  }
});

api.get('/cases/:id/actions', async (req, res) => {
  try {
    const actions = await db.listActionsForCase(req.params.id);
    return res.json(actions.map(toApiAction));
  } catch (err) {
    return fail(res, err);
  }
});

/** The mentor directory: the JSON seed merged with dashboard-added mentors. */
api.get('/mentors', (_req, res) => {
  return res.json(
    allMentors().map((m) => ({
      name: m.name,
      intro: m.intro,
      ...(m.variants ? { variants: m.variants } : {}),
      email: m.email ?? null,
      phone: m.phone ?? null,
      sync_user_id: m.syncUserId ?? null,
    }))
  );
});

const newMentorSchema = z.object({
  name: z.string().trim().min(1).max(200),
  intro: z.string().trim().min(1).max(8000),
  email: z.string().trim().email().max(320).optional(),
  // Required, not optional: SYNC's users.phone_number is NOT NULL and is what
  // an account is keyed on, and it is also the number the group invite is DM'd
  // to. A mentor without one can be introduced but never linked to anything.
  phone: z.string().trim().min(3).max(40),
  variants: z.record(z.string(), z.string()).optional(),
  actor: z.string().trim().min(1).optional(),
});

/**
 * POST /api/mentors
 *
 * Add a mentor to the directory (the `mentors` table). The new mentor is
 * available to the picker and the matcher immediately -- the cache is
 * refreshed before responding. A duplicate name is a 409.
 */
api.post('/mentors', async (req, res) => {
  const parsed = newMentorSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      error: 'Invalid request body',
      issues: parsed.error.issues.map((i) => ({
        path: i.path.join('.'),
        message: i.message,
      })),
    });
  }

  try {
    const mentor = await db.insertMentor({
      name: parsed.data.name,
      intro: parsed.data.intro,
      email: parsed.data.email ?? null,
      phone: parsed.data.phone,
      variants: parsed.data.variants ?? null,
      createdBy: parsed.data.actor ?? null,
    });

    // Then give them a SYNC account. Deliberately after the local insert and
    // deliberately not fatal: SYNC being unreachable shouldn't stop the team
    // adding a mentor, and the backfill retries whatever didn't land. The
    // warning goes back with the 201 so it is seen straight away rather than
    // only in the logs.
    const { syncUserId, warning } = await ensureMentorOnSync(mentor);

    await refreshMentors();
    return res.status(201).json({
      name: mentor.name,
      intro: mentor.intro,
      ...(mentor.variants ? { variants: mentor.variants } : {}),
      email: mentor.email,
      phone: mentor.phone,
      sync_user_id: syncUserId,
      ...(warning ? { warning } : {}),
    });
  } catch (err) {
    if (err instanceof db.DbError && err.status === 409) {
      return res.status(409).json({ error: `A mentor named "${parsed.data.name}" already exists.` });
    }
    return fail(res, err);
  }
});

/** Who a meeting can be booked with. The URLs stay server-side. */
api.get('/hosts', (_req, res) => {
  return res.json(hosts.map((h) => ({ name: h.name })));
});

/** Curriculum subjects offered in the Project Setup action's dropdown. */
api.get('/curriculum-subjects', (_req, res) => {
  return res.json({ subjects: config.curriculum.subjects });
});

// ---------------------------------------------------------------------------
// Project setup (Stage 5)
// ---------------------------------------------------------------------------

function toApiProjectSetup(s: db.ProjectSetup) {
  return {
    case_id: s.caseId,
    project_title: s.projectTitle,
    project_description: s.projectDescription,
    curriculum_subject: s.curriculumSubject,
    submitted_at: iso(s.submittedAt),
    submitted_by: s.submittedBy,
    status: s.status,
    step_whatsapp: s.stepWhatsapp,
    step_whatsapp_drive_link: s.stepWhatsappDriveLink,
    step_sync: s.stepSync,
    step_drive: s.stepDrive,
    step_mentor_access: s.stepMentorAccess,
    step_curriculum: s.stepCurriculum,
    step_cosmic_student: s.stepCosmicStudent,
    step_cosmic_project: s.stepCosmicProject,
    step_cosmic_sync_group: s.stepCosmicSyncGroup,
    drive_folder_url: s.driveFolderUrl,
    cosmic_student_id: s.cosmicStudentId,
    cosmic_project_id: s.cosmicProjectId,
    last_error: s.lastError,
  };
}

/**
 * GET /api/cases/:id/project-setup
 *
 * The Stage 5 details entered so far (or null if none yet), plus the cron's
 * progress. The dashboard shows this to prefill the form and report status.
 */
api.get('/cases/:id/project-setup', async (req, res) => {
  try {
    const groupCase = await db.findCaseById(req.params.id);
    if (!groupCase) return res.status(404).json({ error: 'case not found' });
    const setup = await db.findProjectSetup(req.params.id);
    return res.json(setup ? toApiProjectSetup(setup) : null);
  } catch (err) {
    return fail(res, err);
  }
});

const projectSetupSchema = z.object({
  project_title: z.string().trim().min(1),
  project_description: z.string().trim().max(4000).optional(),
  curriculum_subject: z.string().trim().max(200).optional(),
  /** Signed-in dashboard user, recorded as submitted_by. */
  actor: z.string().trim().min(1).optional(),
});

/**
 * POST /api/cases/:id/project-setup
 *
 * Save the project title / description / curriculum choice and mark the case
 * ready for the project-setup service to run. This does NOT send anything or
 * touch WhatsApp/Drive itself -- it only records intent; the setup cron acts on
 * it. Safe to call again to correct details.
 */
api.post('/cases/:id/project-setup', async (req, res) => {
  const parsed = projectSetupSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      error: 'Invalid request body',
      issues: parsed.error.issues.map((i) => ({
        path: i.path.join('.'),
        message: i.message,
      })),
    });
  }

  try {
    const groupCase = await db.findCaseById(req.params.id);
    if (!groupCase) return res.status(404).json({ error: 'case not found' });

    const subject = (parsed.data.curriculum_subject ?? '').trim();
    const description = (parsed.data.project_description ?? '').trim();
    const setup = await db.upsertProjectSetup(req.params.id, {
      projectTitle: parsed.data.project_title,
      projectDescription: description || null,
      curriculumSubject: subject || null,
      submittedBy: parsed.data.actor ?? null,
    });

    // Mirror the project title/description into the intake sheet row.
    // Best-effort: the details are already saved, so a sheet hiccup must not
    // fail the request.
    if (sheets.sheetsConfigured() && groupCase.sheetRow) {
      try {
        await sheets.writeRowCells(groupCase.sheetRow, {
          'Project Name': parsed.data.project_title,
          'Project Description': description,
        });
        // Only now that the sheet actually holds these values: this is what
        // tells the sync cron the row matches the database, so its next pass
        // sees no edit and leaves the details alone. Skipping it on failure is
        // deliberate -- see markSheetDetailsSeen.
        await db.markSheetDetailsSeen(req.params.id, {
          title: parsed.data.project_title,
          description,
        });
      } catch (err) {
        console.error(`[case ${req.params.id}] writing project details to the sheet failed:`, err);
      }
    }

    return res.json(toApiProjectSetup(setup));
  } catch (err) {
    return fail(res, err);
  }
});

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

const actionSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('ADD_MENTOR'),
    mentor: z.string().trim().min(1),
    variant: z.string().trim().min(1).optional(),
  }),
  z.object({
    kind: z.literal('CS_ASSESSMENT'),
    deadline: z.string().trim().min(1),
  }),
  z.object({
    kind: z.literal('PROTOTYPING_ASSESSMENT'),
    deadline: z.string().trim().min(1),
  }),
  z.object({
    kind: z.literal('SCHEDULE_MEETING'),
    host: z.string().trim().min(1),
  }),
]);

const requestSchema = z.intersection(
  actionSchema,
  z.object({
    /** Signed-in dashboard user, for the audit trail. */
    actor: z.string().trim().min(1).optional(),
    /**
     * One per confirmed dialog. Send it and a retry or double-click replays the
     * first result instead of sending a second WhatsApp message.
     */
    idempotency_key: z.string().trim().min(1).max(200).optional(),
  })
);

/**
 * POST /api/cases/:id/preview
 *
 * The exact message an action would send, rendered but not sent and not
 * recorded. The dashboard shows this before asking for confirmation.
 *
 * It exists so the preview cannot drift from reality: rendering the copy a
 * second time in the dashboard would eventually show an operator one message
 * while a family received another. Same templates, same config, same code path
 * up to the send.
 */
api.post('/cases/:id/preview', async (req, res) => {
  const parsed = actionSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Invalid request body' });
  }

  try {
    const groupCase = await db.findCaseById(req.params.id);
    if (!groupCase) return res.status(404).json({ error: 'case not found' });

    return res.json({ message: renderPreview(groupCase, parsed.data) });
  } catch (err) {
    return fail(res, err);
  }
});

/**
 * POST /api/cases/:id/actions
 *
 * Carries out one instruction: sends the WhatsApp message and records what
 * happened. Returns the updated case and the action, matching what the
 * dashboard's action functions already expect back.
 */
api.post('/cases/:id/actions', async (req, res) => {
  const parsed = requestSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      error: 'Invalid request body',
      issues: parsed.error.issues.map((i) => ({
        path: i.path.join('.'),
        message: i.message,
      })),
    });
  }

  const { actor, idempotency_key: idempotencyKey, ...action } = parsed.data;

  try {
    const groupCase = await db.findCaseById(req.params.id);
    if (!groupCase) return res.status(404).json({ error: 'case not found' });

    const result = await performAction({
      case: groupCase,
      action: action as ActionInput,
      actor: actor ?? null,
      idempotencyKey: idempotencyKey ?? null,
    });

    return res.status(result.replayed ? 200 : 201).json({
      case: toApiCase(result.case),
      action: toApiAction(result.action),
      replayed: result.replayed,
    });
  } catch (err) {
    return fail(res, err);
  }
});
