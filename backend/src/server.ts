import express from 'express';
import { z } from 'zod';
import { config } from './config';
import * as db from './db';
import { openCase, registerCase } from './cases';
import { api } from './api';
import { startScheduler } from './scheduler';
import { refreshMentors } from './mentors';

const app = express();

app.use(express.json({ limit: '1mb' }));

// Everything the operations dashboard reads and writes.
app.use('/api', api);

app.get('/health', async (_req, res) => {
  try {
    await db.ping();
    return res.json({ ok: true });
  } catch (err) {
    console.error('healthcheck failed:', err);
    return res.status(503).json({ ok: false, error: 'database unreachable' });
  }
});

const intakeSchema = z.object({
  chat_id: z.string().trim().min(1),
  group_name: z.string().trim().min(1),
  student_name: z.string().trim().min(1),
  student_phone: z.string().trim().optional(),
  student_email: z.string().trim().optional(),
  parent_name: z.string().trim().optional(),
  parent_phone: z.string().trim().optional(),
  parent_email: z.string().trim().optional(),
  project_name: z.string().trim().optional(),
  source: z.string().trim().optional(),
  sheet_row: z.number().int().positive().optional(),
  group_request_id: z.string().trim().optional(),
  supabase_group_id: z.string().trim().optional(),
  invite_link: z.string().trim().optional(),
});

/**
 * POST /group-created
 *
 * Called by the group-creation service once a WhatsApp group exists. Stores
 * the group with everything known about it and opens the Slack thread that
 * decides what happens next.
 */
/**
 * POST /group-registered
 *
 * Called by the group-creation service the moment a WhatsApp group exists,
 * before anyone has joined it. Records the case so the project shows on the
 * dashboard -- and so its title and description can be filled in -- while the
 * family is still holding an invite link.
 *
 * No Slack thread is opened: there is nothing to decide until they join, and
 * that is what POST /group-created does when they do. Safe to call repeatedly.
 */
app.post('/group-registered', async (req, res) => {
  const auth = req.get('authorization') ?? '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (token !== config.intake.secret) {
    return res.status(401).json({ ok: false, error: 'bad or missing token' });
  }

  const parsed = intakeSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      ok: false,
      error: 'Invalid request body',
      issues: parsed.error.issues.map((i) => ({
        path: i.path.join('.'),
        message: i.message,
      })),
    });
  }

  const body = parsed.data;

  try {
    const result = await registerCase({
      chatId: body.chat_id,
      groupName: body.group_name,
      studentName: body.student_name,
      studentPhone: body.student_phone ?? null,
      studentEmail: body.student_email ?? null,
      parentName: body.parent_name ?? null,
      parentPhone: body.parent_phone ?? null,
      parentEmail: body.parent_email ?? null,
      projectName: body.project_name ?? null,
      source: body.source ?? null,
      sheetRow: body.sheet_row ?? null,
      groupRequestId: body.group_request_id ?? null,
      supabaseGroupId: body.supabase_group_id ?? null,
      inviteLink: body.invite_link ?? null,
      payload: body,
    });

    return res.status(result.created ? 201 : 200).json({
      ok: true,
      created: result.created,
      case_id: result.case.id,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('group-registered failed:', err);
    // 5xx on purpose: the caller should retry, and registerCase is a no-op the
    // second time round.
    return res.status(502).json({ ok: false, error: message });
  }
});

app.post('/group-created', async (req, res) => {
  const auth = req.get('authorization') ?? '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (token !== config.intake.secret) {
    return res.status(401).json({ ok: false, error: 'bad or missing token' });
  }

  const parsed = intakeSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      ok: false,
      error: 'Invalid request body',
      issues: parsed.error.issues.map((i) => ({
        path: i.path.join('.'),
        message: i.message,
      })),
    });
  }

  const body = parsed.data;

  try {
    const result = await openCase({
      chatId: body.chat_id,
      groupName: body.group_name,
      studentName: body.student_name,
      studentPhone: body.student_phone ?? null,
      studentEmail: body.student_email ?? null,
      parentName: body.parent_name ?? null,
      parentPhone: body.parent_phone ?? null,
      parentEmail: body.parent_email ?? null,
      projectName: body.project_name ?? null,
      source: body.source ?? null,
      sheetRow: body.sheet_row ?? null,
      groupRequestId: body.group_request_id ?? null,
      supabaseGroupId: body.supabase_group_id ?? null,
      inviteLink: body.invite_link ?? null,
      payload: body,
    });

    return res.status(result.created ? 201 : 200).json({
      ok: true,
      created: result.created,
      case_id: result.case.id,
      slack_thread_ts: result.case.slackThreadTs,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('group-created failed:', err);
    // 5xx on purpose: the caller should retry, and openCase is safe to replay.
    return res.status(502).json({ ok: false, error: message });
  }
});

async function main() {
  // Fail at boot rather than on the first request if the tables are missing or
  // the service key is wrong.
  await db.ping();

  const server = app.listen(config.port, () => {
    console.log(`POST http://localhost:${config.port}/group-created`);
    console.log(`GET  http://localhost:${config.port}/api/cases/summaries`);
    console.log(`Slack channel (nudges only): ${config.slack.channel}`);
    if (!config.dashboard.url) {
      console.warn(
        'DASHBOARD_URL is not set -- Slack nudges will name the dashboard ' +
          'but cannot link to the group'
      );
    }
  });

  startScheduler();

  // Warm the dashboard-added mentors into the in-memory cache, then keep it
  // fresh. Adding a mentor refreshes this immediately; the timer is a backstop.
  void refreshMentors();
  setInterval(() => void refreshMentors(), 5 * 60 * 1000);

  // Nothing to close but the listener: storage is stateless HTTP now, so
  // there is no connection pool to drain.
  const shutdown = (signal: string) => {
    console.log(`\n${signal} -- shutting down`);
    server.close();
    process.exit(0);
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((err) => {
  console.error('Failed to start:', err);
  process.exit(1);
});
