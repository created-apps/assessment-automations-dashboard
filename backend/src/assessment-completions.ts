import { config } from './config';
import * as db from './db';
import * as sheets from './sheets';
import * as slack from './slack';
import * as templates from './templates';

/**
 * Assessment completion check.
 *
 * When a CS or Prototyping assessment is sent to a group, the student fills the
 * Google Form. Its responses land in a response spreadsheet keyed by email. This
 * job reads those two sheets and, for every case whose assessment was sent (and
 * not yet announced), checks whether the student's email has shown up. If it
 * has, it posts to Slack and records the completion so it fires exactly once.
 *
 * Cases are only checked for a window after the assessment was sent
 * (ASSESSMENT_CHECK_WINDOW_DAYS), so a form nobody ever fills isn't polled
 * forever.
 */

export interface CompletionSummary {
  checked: number;
  announced: number;
  errors: number;
  note?: string;
}

/** Read a response sheet into a set of emails, or null if it can't be read. */
async function readEmails(
  sheetId: string,
  tab: string,
  label: string
): Promise<Set<string> | null> {
  if (!sheetId) return null;
  try {
    return await sheets.readColumnValues(sheetId, tab, config.assessmentResponses.emailColumn);
  } catch (err) {
    console.error(`assessment completions: could not read ${label} responses:`, err);
    return null;
  }
}

export async function runAssessmentCompletions(): Promise<CompletionSummary> {
  const summary: CompletionSummary = { checked: 0, announced: 0, errors: 0 };

  if (!config.google.creds) {
    summary.note = 'Google credentials not set -- skipped';
    return summary;
  }
  const { cs, prototyping } = config.assessmentResponses;
  if (!cs.sheetId && !prototyping.sheetId) {
    summary.note = 'no response sheet ids configured -- skipped';
    return summary;
  }

  const since = new Date(Date.now() - config.assessmentResponses.checkWindowDays * 24 * 60 * 60 * 1000);
  const sent = await db.listSentAssessments(since);
  if (sent.length === 0) {
    summary.note = 'no assessments sent in the window';
    return summary;
  }

  const done = await db.listCompletedAssessmentKeys();
  const pending = sent.filter((a) => !done.has(`${a.caseId}|${a.kind}`));
  if (pending.length === 0) return summary;

  // Read each sheet once, but only if there's actually a pending case for it.
  const needCs = pending.some((a) => a.kind === 'CS_ASSESSMENT');
  const needProto = pending.some((a) => a.kind === 'PROTOTYPING_ASSESSMENT');
  const emailsByKind: Record<db.AssessmentKind, Set<string> | null> = {
    CS_ASSESSMENT: needCs ? await readEmails(cs.sheetId, cs.tab, 'CS') : null,
    PROTOTYPING_ASSESSMENT: needProto
      ? await readEmails(prototyping.sheetId, prototyping.tab, 'Prototyping')
      : null,
  };

  // Cases are fetched once and looked up by id.
  const cases = new Map((await db.listCases()).map((c) => [c.id, c]));

  for (const a of pending) {
    const emails = emailsByKind[a.kind];
    if (!emails) continue; // sheet unread/unconfigured for this kind
    const groupCase = cases.get(a.caseId);
    const email = (groupCase?.studentEmail ?? '').trim().toLowerCase();
    if (!groupCase || !email) continue;

    summary.checked += 1;
    if (!emails.has(email)) continue;

    try {
      const isNew = await db.recordAssessmentCompletion(a.caseId, a.kind, groupCase.studentEmail);
      if (!isNew) continue; // someone/another tick already announced it
      await slack.postMessage({
        text: templates.assessmentCompleted(
          {
            studentName: groupCase.studentName,
            studentEmail: groupCase.studentEmail,
            groupName: groupCase.groupName,
            caseId: groupCase.id,
            dashboardUrl: config.dashboard.url || undefined,
          },
          a.kind
        ),
      });
      summary.announced += 1;
    } catch (err) {
      summary.errors += 1;
      console.error(`[${a.caseId}] announcing ${a.kind} completion failed:`, err);
    }
  }

  return summary;
}
