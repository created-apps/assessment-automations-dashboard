import { config } from './config';
import * as db from './db';
import * as slack from './slack';
import { performAction, Rejected, type ActionInput } from './cases';

/**
 * The queue runner.
 *
 * The team lines up a group's follow-up before anyone is in the group -- the
 * assessments, the mentor introduction, a booking link -- and this sends them,
 * in order, once the family has joined and the welcome has gone out.
 *
 * "The welcome has fired" needs no new signal: the welcome is what triggers the
 * handover, and the handover is what moves a case off AWAITING_JOIN. So the
 * gate is simply `stage != 'AWAITING_JOIN'`, which listCasesWithQueue filters
 * on directly.
 *
 * Three rules, all of them chosen deliberately:
 *
 *  - **One action per case per tick, and only after a gap.** A family that has
 *    just joined should not get four notifications in the same second. The gap
 *    is measured from the last thing this queue sent them, so it paces the
 *    queue without pacing anything else.
 *
 *  - **A failure stops that case's queue.** The actions are ordered because
 *    the order matters; sending the assessment that follows a mentor
 *    introduction which never happened is worse than sending nothing. The rest
 *    stay QUEUED and Slack is told.
 *
 *  - **Other cases are unaffected.** One stuck case must not hold up anyone
 *    else's queue, so each case is handled independently.
 */

export interface QueueSummary {
  /** Cases past the welcome with something still queued. */
  cases: number;
  sent: number;
  failed: number;
  /** Cases skipped this tick because their gap hadn't elapsed. */
  waiting: number;
  errors: number;
}

/** A queued row turned into the action input performAction expects. */
function toActionInput(queued: db.QueuedAction): ActionInput {
  const params = queued.params ?? {};

  switch (queued.kind) {
    case 'ADD_MENTOR': {
      const mentor = String(params.mentor ?? '').trim();
      if (!mentor) throw new Error('queued ADD_MENTOR has no mentor name');
      const variant = String(params.variant ?? '').trim();
      return { kind: 'ADD_MENTOR', mentor, ...(variant ? { variant } : {}) };
    }
    case 'SCHEDULE_MEETING': {
      const host = String(params.host ?? '').trim();
      if (!host) throw new Error('queued SCHEDULE_MEETING has no host');
      return { kind: 'SCHEDULE_MEETING', host };
    }
    case 'CS_ASSESSMENT':
    case 'PROTOTYPING_ASSESSMENT':
      return { kind: queued.kind, deadline: deadlineFor(params) };
  }
}

/**
 * The deadline, worked out now rather than when it was queued.
 *
 * Stored as a number of days precisely so a queue that waited a week on a
 * family still sends a deadline that is a week away, not one that has already
 * passed. Rendered as YYYY-MM-DD from the local calendar, which is the shape
 * parseDeadline prints straight back into the message.
 */
function deadlineFor(params: Record<string, unknown>): string {
  const days = Number(params.deadline_days);
  if (!Number.isFinite(days) || days <= 0) {
    throw new Error(`queued assessment has no usable deadline_days (${String(params.deadline_days)})`);
  }
  const due = new Date();
  due.setDate(due.getDate() + Math.round(days));
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${due.getFullYear()}-${pad(due.getMonth() + 1)}-${pad(due.getDate())}`;
}

/** Has enough time passed since the last thing this queue sent the group? */
function gapElapsed(queue: db.QueuedAction[]): boolean {
  const lastSent = queue
    .filter((a) => a.status === 'SENT' && a.sentAt)
    .map((a) => a.sentAt!.getTime())
    .sort((a, b) => b - a)[0];
  if (lastSent === undefined) return true; // nothing sent yet -- go now
  return Date.now() - lastSent >= config.queue.gapSeconds * 1000;
}

async function runOneCase(caseId: string, summary: QueueSummary): Promise<void> {
  const queue = await db.listQueuedForCase(caseId);

  // A FAILED row ahead of the queue means this case is stopped and waiting on
  // a person. Nothing behind it may overtake it.
  if (queue.some((a) => a.status === 'FAILED')) return;

  // Same rule for a held mentor introduction. ADD_MENTOR now invites the
  // mentor and waits for them to join before the introduction goes out, and
  // the queue is ordered because the order matters -- an assessment must not
  // reach the family ahead of the introduction it was queued behind. The
  // five-minute job clears this by sending the introduction.
  const groupCase = await db.findCaseById(caseId);
  if (!groupCase) throw new Error(`case ${caseId} vanished`);

  // Stopped between listCasesWithQueue and now. The working set already
  // excludes stopped cases, so this only catches that race -- but the race is
  // exactly the one that matters, because the other side of it is a message
  // arriving at a family somebody has just told us to stop messaging.
  if (groupCase.operationsStoppedAt) return;

  if (groupCase.pendingMentorName) {
    summary.waiting += 1;
    return;
  }

  const next = queue.find((a) => a.status === 'QUEUED');
  if (!next) return;

  if (!gapElapsed(queue)) {
    summary.waiting += 1;
    return;
  }

  // Compare-and-set on (status, attempts): if another tick already took this
  // row, we get nothing back and leave it alone.
  const claimed = await db.claimQueuedAction(next.id, next.attempts);
  if (!claimed) return;

  try {
    const result = await performAction({
      case: groupCase,
      action: toActionInput(claimed),
      actor: claimed.queuedBy ?? 'queue',
      // The queued row's own id: a runner that somehow ran twice replays the
      // first result instead of sending the family a second copy.
      idempotencyKey: `queued:${claimed.id}`,
    });

    await db.updateQueuedAction(claimed.id, {
      status: 'SENT',
      caseActionId: result.action.id,
      sentAt: new Date(),
      error: null,
    });
    summary.sent += 1;
    console.log(`[${caseId}] queued ${claimed.kind} sent (position ${claimed.position})`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await db.updateQueuedAction(claimed.id, {
      status: 'FAILED',
      error: message.slice(0, 2000),
    });
    summary.failed += 1;

    const remaining = queue.filter(
      (a) => a.status === 'QUEUED' && a.id !== claimed.id
    ).length;
    await slack.postMessage({
      text:
        `:warning: Queued *${claimed.kind}* failed for *${groupCase.groupName}*: ${message}\n` +
        (remaining > 0
          ? `The ${remaining} action(s) behind it are on hold until this is sorted out.`
          : 'Nothing else was queued behind it.'),
      ...(groupCase.slackChannel && groupCase.slackThreadTs
        ? { channel: groupCase.slackChannel, threadTs: groupCase.slackThreadTs }
        : {}),
    });
    console.error(`[${caseId}] queued ${claimed.kind} FAILED:`, message);

    // A Rejected is a bad instruction (unknown mentor, no booking link), not an
    // outage: worth saying plainly in the log that retrying won't help.
    if (err instanceof Rejected) {
      console.error(`[${caseId}] ...that is an instruction problem, not a transient one`);
    }
  }
}

/** One pass: advance every case whose queue is open and whose gap has passed. */
export async function runQueue(): Promise<QueueSummary> {
  const summary: QueueSummary = { cases: 0, sent: 0, failed: 0, waiting: 0, errors: 0 };

  const caseIds = await db.listCasesWithQueue();
  summary.cases = caseIds.length;

  for (const caseId of caseIds) {
    try {
      await runOneCase(caseId, summary);
    } catch (err) {
      summary.errors += 1;
      console.error(`[${caseId}] queue run threw:`, err);
    }
  }
  return summary;
}
