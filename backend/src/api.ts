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
// import * as sheets from './sheets'; // re-enable with the sheet write-back below
import { ensureMentorOnSync } from './mentor-sync';
import * as sync from './sync';

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
    // The introduction that is written but not sent, and since when -- this is
    // the only place a mentor who never joined the group becomes visible.
    pending_mentor_name: c.pendingMentorName,
    pending_mentor_since: iso(c.pendingMentorSince),
    mentor_joined_at: iso(c.mentorJoinedAt),
    first_class_confirmed_at: iso(c.firstClassConfirmedAt),
    first_class_confirmed_reason: c.firstClassConfirmedReason,
    first_class_prompt_count: c.firstClassPromptCount,
    first_class_prompted_at: iso(c.firstClassPromptedAt),
    // The kill switch, so the dashboard can show a stopped group as stopped
    // and hide the buttons that would now be refused anyway.
    operations_stopped_at: iso(c.operationsStoppedAt),
    operations_stopped_by: c.operationsStoppedBy,
    operations_stopped_reason: c.operationsStoppedReason,
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

/**
 * A mentor's named introductions: label -> the wording that goes out.
 *
 * Labels are lowercased on the way in. They are the key `introFor` resolves a
 * queued action against, so two labels differing only in case would be two
 * rows that mean the same thing -- and whichever Postgres returned first would
 * silently win. "general" is reserved: the dashboard uses it as the name for
 * the default `intro`, so a named introduction called that would show up twice
 * in the picker meaning two different things.
 */
const RESERVED_VARIANT_LABELS = ['general', 'default'];

const variantsSchema = z
  .record(z.string().trim().min(1).max(60), z.string().trim().min(1).max(8000))
  /*
   * Validated BEFORE the lowercasing below, which is the only order that
   * works: "Chemistry" and "chemistry" are two distinct keys in the request
   * and one key afterwards, so a check that ran on the transformed object
   * would see nothing wrong while one of the two wordings had already been
   * dropped on the floor.
   */
  .superRefine((v, ctx) => {
    const keys = Object.keys(v);

    if (keys.length > 12) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'at most 12 named introductions per mentor',
      });
    }

    const seen = new Set<string>();
    for (const key of keys) {
      const label = key.trim().toLowerCase();
      if (RESERVED_VARIANT_LABELS.includes(label)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `"${label}" is reserved -- it is what the default introduction is called`,
        });
      }
      if (seen.has(label)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `two introductions are both named "${label}"`,
        });
      }
      seen.add(label);
    }
  })
  .transform((v) =>
    Object.fromEntries(
      Object.entries(v).map(([key, text]) => [key.trim().toLowerCase(), text])
    )
  );

const newMentorSchema = z.object({
  name: z.string().trim().min(1).max(200),
  intro: z.string().trim().min(1).max(8000),
  email: z.string().trim().email().max(320).optional(),
  // Required, not optional: SYNC's users.phone_number is NOT NULL and is what
  // an account is keyed on, and it is also the number the group invite is DM'd
  // to. A mentor without one can be introduced but never linked to anything.
  phone: z.string().trim().min(3).max(40),
  variants: variantsSchema.optional(),
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

const mentorEditSchema = z
  .object({
    intro: z.string().trim().min(1).max(8000).optional(),
    /**
     * Nullable so an address entered by mistake can be removed, not just
     * replaced. Absent means "leave it alone"; null means "clear it".
     */
    email: z.string().trim().email().max(320).nullable().optional(),
    phone: z.string().trim().min(3).max(40).nullable().optional(),
    /**
     * The whole set, replaced. Null clears them, leaving the default `intro`
     * as the only wording -- which is how a named introduction is deleted.
     */
    variants: variantsSchema.nullable().optional(),
    actor: z.string().trim().min(1).optional(),
  })
  .refine(
    (b) =>
      b.intro !== undefined ||
      b.email !== undefined ||
      b.phone !== undefined ||
      b.variants !== undefined,
    'give at least one of intro, email, phone or variants'
  );

/**
 * PATCH /api/mentors/:name
 *
 * Change a mentor's introduction, email or phone. The name identifies them and
 * is not editable: it is what every other part of the system matches them on.
 *
 * The email matters more than it looks. The intake sheet identifies a group's
 * mentor by an exact email match against this column -- see directoryEntry in
 * mentor-intake.ts -- so a mentor with no address here cannot be named from
 * the sheet at all, and this is the only way to give them one.
 *
 * Seed mentors (data/mentors.json) have no row to update, so editing one
 * writes a row carrying their other fields across; allMentors() has a DB row
 * override a seed entry of the same name, so from then on the edited values
 * are what the picker, the preview and the sheet lookup all see.
 */
api.patch('/mentors/:name', async (req, res) => {
  const parsed = mentorEditSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      error: 'Invalid request body',
      issues: parsed.error.issues.map((i) => ({
        path: i.path.join('.'),
        message: i.message,
      })),
    });
  }

  const wanted = (req.params.name ?? '').trim().toLowerCase();
  const current = allMentors().find((m) => m.name.trim().toLowerCase() === wanted);
  if (!current) {
    return res.status(404).json({ error: `No mentor named "${req.params.name}".` });
  }

  const { intro, email, phone, variants, actor } = parsed.data;

  // Two mentors sharing an address is worse than it sounds: findMentorByEmail
  // treats a duplicate as no match rather than picking between them, so this
  // would silently make BOTH of them unfindable from the intake sheet. Refuse
  // it here, where there is somebody to tell.
  if (email) {
    const clash = allMentors().find(
      (m) =>
        (m.email ?? '').trim().toLowerCase() === email.trim().toLowerCase() &&
        m.name.trim().toLowerCase() !== wanted
    );
    if (clash) {
      return res.status(409).json({
        error:
          `${clash.name} already has the email ${email}. An address identifies ` +
          `exactly one mentor, so it cannot be shared.`,
      });
    }
  }

  try {
    const existing = await db.findDbMentorByName(current.name);

    let mentor = existing;
    if (!mentor) {
      // First edit of a seed mentor: give them a row carrying what the seed
      // holds, with this edit applied on top.
      mentor = await db.insertMentor({
        name: current.name,
        intro: intro ?? current.intro,
        // The edit wins over what the seed holds, so a seed mentor's named
        // introductions can be changed on the same edit that creates their row.
        variants: variants !== undefined ? variants : current.variants ?? null,
        email: email !== undefined ? email : current.email ?? null,
        phone: phone !== undefined ? phone : current.phone ?? null,
        createdBy: actor ?? null,
      });
    } else {
      if (intro !== undefined) {
        mentor = await db.updateMentorIntro(mentor.id, intro);
      }
      if (variants !== undefined) {
        mentor = await db.updateMentorVariants(mentor.id, variants);
      }
      if (email !== undefined || phone !== undefined) {
        mentor = await db.updateMentorContact(mentor.id, {
          ...(email !== undefined ? { email } : {}),
          ...(phone !== undefined ? { phone } : {}),
        });
      }
    }

    await refreshMentors();
    return res.json({
      name: mentor.name,
      intro: mentor.intro,
      ...(mentor.variants ? { variants: mentor.variants } : {}),
      email: mentor.email,
      phone: mentor.phone,
      sync_user_id: mentor.syncUserId,
    });
  } catch (err) {
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

    // DISABLED: mirroring the project title/description back into the intake
    // sheet row. The dashboard no longer writes to the sheet, so the two can
    // drift for a case edited here -- the database is the current value and
    // the sheet keeps whatever it last held.
    //
    // Safe to leave the sheet-sync cron running alongside this: it only acts
    // when the sheet differs from `sheet_details_seen`, and this block is also
    // the only thing that moved `seen`. With both commented out, seen still
    // matches the sheet, so the next pass sees no edit and does not read the
    // sheet's older text back over these details.
    //
    // Re-enable by uncommenting -- the markSheetDetailsSeen call must stay
    // inside the try, after the write, or a failed write would record values
    // the sheet never received.
    //
    // if (sheets.sheetsConfigured() && groupCase.sheetRow) {
    //   try {
    //     await sheets.writeRowCells(groupCase.sheetRow, {
    //       'Project Name': parsed.data.project_title,
    //       'Project Description': description,
    //     });
    //     await db.markSheetDetailsSeen(req.params.id, {
    //       title: parsed.data.project_title,
    //       description,
    //     });
    //   } catch (err) {
    //     console.error(`[case ${req.params.id}] writing project details to the sheet failed:`, err);
    //   }
    // }

    return res.json(toApiProjectSetup(setup));
  } catch (err) {
    return fail(res, err);
  }
});

// ---------------------------------------------------------------------------
// Queued actions
// ---------------------------------------------------------------------------

function toApiQueued(q: db.QueuedAction) {
  return {
    id: q.id,
    case_id: q.caseId,
    position: q.position,
    kind: q.kind,
    params: q.params,
    status: q.status,
    queued_by: q.queuedBy,
    error: q.error,
    sent_at: iso(q.sentAt),
    created_at: iso(q.createdAt),
  };
}

/**
 * What each kind needs when it eventually runs.
 *
 * Assessments take a NUMBER OF DAYS, not a date: a queued action can wait a
 * week on a family joining, and the date is worked out at send time so it is
 * never stale. See the queue runner.
 */
const queueItemSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('ADD_MENTOR'),
    mentor: z.string().trim().min(1),
    variant: z.string().trim().min(1).optional(),
  }),
  z.object({
    kind: z.literal('CS_ASSESSMENT'),
    deadline_days: z.number().int().min(1).max(365),
  }),
  z.object({
    kind: z.literal('PROTOTYPING_ASSESSMENT'),
    deadline_days: z.number().int().min(1).max(365),
  }),
  z.object({
    kind: z.literal('SCHEDULE_MEETING'),
    host: z.string().trim().min(1),
  }),
]);

const queueSchema = z.intersection(
  queueItemSchema,
  z.object({ actor: z.string().trim().min(1).optional() })
);

/** GET /api/cases/:id/queue -- what is lined up, in the order it will run. */
api.get('/cases/:id/queue', async (req, res) => {
  try {
    const queued = await db.listQueuedForCase(req.params.id);
    return res.json(queued.map(toApiQueued));
  } catch (err) {
    return fail(res, err);
  }
});

/**
 * POST /api/cases/:id/queue
 *
 * Add one action to the end of the case's queue. Nothing is sent here -- the
 * runner sends it once the family has joined and the welcome has gone out.
 *
 * Queuing on a case that is already past that point is allowed and simply
 * means it goes out on the next tick; the dashboard uses the immediate path
 * there instead, but the API doesn't need to care which.
 */
api.post('/cases/:id/queue', async (req, res) => {
  const parsed = queueSchema.safeParse(req.body);
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

    const { actor, kind, ...params } = parsed.data;
    const queued = await db.enqueueAction(req.params.id, {
      kind,
      params,
      queuedBy: actor ?? null,
    });
    return res.status(201).json(toApiQueued(queued));
  } catch (err) {
    return fail(res, err);
  }
});

/** DELETE /api/cases/:id/queue/:queuedId -- drop something not yet sent. */
api.delete('/cases/:id/queue/:queuedId', async (req, res) => {
  try {
    const cancelled = await db.cancelQueuedAction(req.params.id, req.params.queuedId);
    if (!cancelled) {
      return res
        .status(409)
        .json({ error: 'that action is not queued any more -- it may already have been sent' });
    }
    return res.status(204).end();
  } catch (err) {
    return fail(res, err);
  }
});

// ---------------------------------------------------------------------------
// Correcting a phone number
// ---------------------------------------------------------------------------

/**
 * A number as every table here stores it: digits only, country code included.
 *
 * Same rule as the group-creation service's normalizePhone, because the rows
 * this corrects were written by it and are matched on exact equality -- a
 * number saved as "+91 98765 43210" would simply never be found again.
 */
const phoneField = z
  .string()
  .trim()
  .transform((raw) => raw.replace(/\D/g, ''))
  .refine((digits) => digits.length >= 8 && digits.length <= 15, {
    message:
      'Give the number in full, with its country code and no spaces (8-15 digits)',
  });

const phoneChangeSchema = z.object({
  role: z.enum(['student', 'parent']),
  phone: phoneField,
  actor: z.string().trim().min(1).optional(),
});

/** What became of the `participants` row for the number being replaced. */
type ParticipantOutcome =
  /** The row was moved, so the join check now waits on the new number. */
  | { status: 'updated'; mode: db.JoinMode }
  /** They are already in the group under the old number -- row left alone. */
  | { status: 'already_joined' }
  /** The new number already has a row here; nothing to move it onto. */
  | { status: 'target_exists'; joined: boolean }
  /** The old number was never tracked for this group. */
  | { status: 'not_tracked' }
  /** Pre-handover cases only carry a group request; without one there is no row. */
  | { status: 'no_group_request' }
  /** No old number on file, so there is nothing to look the row up by. */
  | { status: 'no_previous_number' };

/**
 * PATCH /api/cases/:id/phone
 *
 * Correct the student's or the parent's number -- the wrong-digit case, which
 * until now meant editing Supabase by hand.
 *
 * Two tables hold it, and the order below is the whole point:
 *
 *  1. `participants`, in the group-creation service. While that service's
 *     group request is PENDING its join check polls for the numbers whose row
 *     says joined=false, and holds the welcome -- and the handover that opens
 *     this case's Slack thread -- until all of them are in the group. That is
 *     the row that is actually waiting on somebody, so it is corrected first:
 *     if this step fails the request stops here, and group_cases keeps the old
 *     number. A case that reads wrong is recoverable; one that reads right
 *     while the automation chases a dead number is the bug nobody would spot.
 *
 *  2. `group_cases`, which is what the dashboard, the nudges and the messages
 *     to the family all read.
 *
 * Then SYNC's `users.phone_number`, best-effort: it is keyed on the number, so
 * leaving it stale is what makes a membership link quietly fail to be created
 * later. It is optional config and a separate project, so a failure there is
 * reported alongside a successful correction rather than undoing it.
 *
 * Nothing is sent and nothing is changed on WhatsApp: the new number is not
 * invited to the group, and the old one is not removed. Getting the right
 * person into the chat stays a deliberate act -- the group's invite link is on
 * the dashboard for exactly that.
 */
api.patch('/cases/:id/phone', async (req, res) => {
  const parsed = phoneChangeSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    return res.status(400).json({
      error: parsed.error.issues[0]?.message ?? 'Invalid request body',
      issues: parsed.error.issues.map((i) => ({
        path: i.path.join('.'),
        message: i.message,
      })),
    });
  }

  const { role, phone, actor } = parsed.data;

  try {
    const groupCase = await db.findCaseById(req.params.id);
    if (!groupCase) return res.status(404).json({ error: 'case not found' });

    const previous =
      role === 'student' ? groupCase.studentPhone : groupCase.parentPhone;

    // Already this number. Reported rather than refused: the caller asked for
    // a state, and it is the state -- but nothing is written, so a retry of a
    // request that did land can't disturb the participant row.
    if (previous === phone) {
      return res.json({
        case: toApiCase(groupCase),
        role,
        previous_phone: previous,
        phone,
        unchanged: true,
        participant: { status: 'not_tracked' } satisfies ParticipantOutcome,
        sync: { status: 'skipped', reason: 'number unchanged' },
      });
    }

    // --- 1. participants, first ---------------------------------------------
    let participant: ParticipantOutcome;
    if (!groupCase.groupRequestId) {
      participant = { status: 'no_group_request' };
    } else if (!previous) {
      participant = { status: 'no_previous_number' };
    } else {
      const rows = await db.findParticipants(groupCase.groupRequestId, previous);
      const row = rows[0];
      if (!row) {
        participant = { status: 'not_tracked' };
      } else if (row.joined) {
        // Whoever holds the old number is in the group already. Moving the row
        // would mark the new number joined without it ever having been there,
        // and the old member would stop being accounted for at all.
        participant = { status: 'already_joined' };
      } else {
        const onNew = await db.findParticipants(
          groupCase.groupRequestId,
          phone
        );
        if (onNew[0]) {
          // (group_request_id, phone) is unique, so there is nowhere to move
          // the row to -- and nothing to fix: the new number is already being
          // waited on, or already in.
          participant = { status: 'target_exists', joined: onNew[0].joined };
        } else {
          const moved = await db.updateParticipantPhone(row.id, phone);
          participant = { status: 'updated', mode: moved.mode };
        }
      }
    }

    // --- 2. group_cases -----------------------------------------------------
    const updated = await db.updateCase(groupCase.id,
      role === 'student' ? { studentPhone: phone } : { parentPhone: phone }
    );

    // --- 3. SYNC, best-effort ----------------------------------------------
    let syncResult: { status: string; reason?: string; name?: string };
    if (!sync.syncConfigured()) {
      syncResult = { status: 'skipped', reason: 'SYNC is not configured' };
    } else if (!previous) {
      syncResult = { status: 'skipped', reason: 'no previous number to find them by' };
    } else {
      try {
        const moved = await sync.moveUserPhone(sync.phoneDigits(previous), phone);
        syncResult =
          moved.status === 'not-found'
            ? { status: 'not_found' }
            : { status: moved.status.replace('-', '_'), name: moved.user.name };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`[${groupCase.id}] SYNC phone update failed:`, err);
        syncResult = { status: 'failed', reason: message };
      }
    }

    console.log(
      `[${groupCase.id}] ${role} phone ${previous ?? 'none'} -> ${phone} ` +
        `by ${actor ?? 'unknown'} (${groupCase.groupName}); ` +
        `participants: ${participant.status}, sync: ${syncResult.status}`
    );

    return res.json({
      case: toApiCase(updated),
      role,
      previous_phone: previous,
      phone,
      unchanged: false,
      participant,
      sync: syncResult,
    });
  } catch (err) {
    return fail(res, err);
  }
});

// ---------------------------------------------------------------------------
// The stop switch
// ---------------------------------------------------------------------------

const stopSchema = z.object({
  actor: z.string().trim().min(1).optional(),
  reason: z.string().trim().max(2000).optional(),
});

/**
 * POST /api/cases/:id/stop
 *
 * Stop every automation for one group, permanently.
 *
 * After this: the mentor nudge, the action queue, the mentor-join check, the
 * first-class chase, the assessment-completion announcements and the sheet
 * sync all skip this case; the Stage 5 setup cron in the project-setup service
 * skips it; the join/welcome check in the group-creation service skips its
 * group; and every send from the dashboard is refused. Anything still queued
 * is cancelled here, so it cannot be resumed by accident either.
 *
 * There is deliberately no way to undo it from the dashboard. Stopping is a
 * decision about a real family, and an un-stop button would make it a toggle
 * somebody could flip back without meaning to -- clearing the column by hand
 * in Supabase is the deliberate act that reversing it should be.
 *
 * Calling it twice is not an error: the second call reports the first stop.
 */
api.post('/cases/:id/stop', async (req, res) => {
  const parsed = stopSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    return res.status(400).json({ error: 'Invalid request body' });
  }

  try {
    const groupCase = await db.findCaseById(req.params.id);
    if (!groupCase) return res.status(404).json({ error: 'case not found' });

    const stopped = await db.stopCase(
      groupCase.id,
      parsed.data.actor ?? null,
      parsed.data.reason ?? null
    );

    // Already stopped: say so and change nothing, so the original actor and
    // timestamp survive.
    if (!stopped) {
      const current = (await db.findCaseById(groupCase.id)) ?? groupCase;
      return res.json({
        case: toApiCase(current),
        cancelled: 0,
        already_stopped: true,
      });
    }

    // Now that nothing will pick the case up again, clear the queue. A failure
    // here leaves rows QUEUED, which is untidy but harmless: the runner's
    // working set no longer contains this case.
    let cancelled = 0;
    try {
      cancelled = await db.cancelQueuedActionsForCase(stopped.id);
    } catch (err) {
      console.error(`[${stopped.id}] stopped, but clearing the queue failed:`, err);
    }

    console.log(
      `[${stopped.id}] OPERATIONS STOPPED by ${parsed.data.actor ?? 'unknown'} ` +
        `(${stopped.groupName}), ${cancelled} queued action(s) cancelled`
    );

    return res.json({
      case: toApiCase(stopped),
      cancelled,
      already_stopped: false,
    });
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
