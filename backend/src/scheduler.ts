import cron from 'node-cron';
import { config } from './config';
import * as db from './db';
import * as slack from './slack';
import * as templates from './templates';
import { summarise } from './cases';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface NudgeSummary {
  open: number;
  nudged: number;
  abandoned: number;
  skipped: number;
  errors: number;
}

/**
 * Daily chase for a mentor.
 *
 * Runs over every case that has had an assessment or a booking link sent but
 * no mentor yet, and re-asks in its Slack thread. Cases still sitting at NEW
 * are left out: nobody has answered the opening message, so a second copy of
 * the same question adds nothing.
 */
export async function runMentorNudge(): Promise<NudgeSummary> {
  const summary: NudgeSummary = {
    open: 0,
    nudged: 0,
    abandoned: 0,
    skipped: 0,
    errors: 0,
  };

  // The rule is "keep asking until a mentor is introduced", so by default
  // nothing is ever abandoned and previously-abandoned cases are picked back
  // up. Only MENTOR_ASSIGNED takes a case out of the rotation.
  const givesUp = config.nudge.giveUpAfterDays > 0;

  const open = givesUp
    ? await db.listCasesByStage('IN_PROGRESS')
    : [
        ...(await db.listCasesByStage('IN_PROGRESS')),
        ...(await db.listCasesByStage('ABANDONED')),
      ].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());

  summary.open = open.length;

  const now = Date.now();
  // The cron fires once a day, but a redeploy restarts it -- this is what
  // stops a second nudge landing in every thread on the same afternoon.
  const nudgeBefore = new Date(
    now - config.nudge.minIntervalHours * 60 * 60 * 1000
  );
  const giveUpBefore = new Date(
    now - config.nudge.giveUpAfterDays * 24 * 60 * 60 * 1000
  );

  for (const groupCase of open) {
    if (groupCase.lastNudgedAt && groupCase.lastNudgedAt > nudgeBefore) {
      summary.skipped += 1;
      continue;
    }

    const daysOpen = Math.max(
      1,
      Math.floor((now - groupCase.createdAt.getTime()) / (24 * 60 * 60 * 1000))
    );

    try {
      if (givesUp && groupCase.createdAt < giveUpBefore) {
        await slack.postMessage({
          text: templates.nudgeGivenUp(
            summarise(groupCase),
            config.nudge.giveUpAfterDays
          ),
          channel: groupCase.slackChannel,
          threadTs: groupCase.slackThreadTs,
        });
        await db.updateCase(groupCase.id, {
          stage: 'ABANDONED',
          lastNudgedAt: new Date(),
        });
        summary.abandoned += 1;
        console.log(`[${groupCase.id}] abandoned after ${daysOpen} days`);
        continue;
      }

      await slack.postMessage({
        text: templates.mentorNudge(summarise(groupCase), daysOpen),
        channel: groupCase.slackChannel,
        threadTs: groupCase.slackThreadTs,
      });
      // PostgREST has no atomic increment. This job is the only writer of
      // nudge_count, it runs single-replica, and the guarded() wrapper stops
      // two ticks overlapping -- so read-and-write is safe here.
      await db.updateCase(groupCase.id, {
        lastNudgedAt: new Date(),
        nudgeCount: groupCase.nudgeCount + 1,
        // A case abandoned under an older cutoff is being chased again, so the
        // stage shouldn't keep claiming otherwise.
        ...(groupCase.stage === 'ABANDONED'
          ? { stage: 'IN_PROGRESS' as const }
          : {}),
      });
      summary.nudged += 1;
    } catch (err) {
      summary.errors += 1;
      console.error(`[${groupCase.id}] nudge failed:`, err);
    }

    // Slack's per-channel posting limit is about one message a second.
    await sleep(1200);
  }

  return summary;
}

/** Wrap a job so a slow run can never overlap the next tick. */
function guarded(name: string, job: () => Promise<unknown>) {
  let running = false;
  return async () => {
    if (running) {
      console.warn(`${name} still running, skipping this tick`);
      return;
    }
    running = true;
    try {
      console.log(`${name}:`, await job());
    } catch (err) {
      console.error(`${name} failed:`, err);
    } finally {
      running = false;
    }
  };
}

function schedule(name: string, expression: string, job: () => Promise<unknown>) {
  if (!cron.validate(expression)) {
    console.error(`Invalid cron for ${name}: ${expression}`);
    process.exit(1);
  }
  cron.schedule(expression, guarded(name, job));
  console.log(`${name} scheduled: ${expression}`);
}

export function startScheduler() {
  // One job. Slack is notification-only now, so nothing is read on a timer.
  schedule('mentor nudge', config.nudge.cron, runMentorNudge);
}
