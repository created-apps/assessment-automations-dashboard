import { config } from './config';
import * as db from './db';
import * as periskope from './periskope';
import * as slack from './slack';
import * as sync from './sync';
import * as templates from './templates';
import { findMentor } from './mentors';

/**
 * The daily ask about the first class.
 *
 * Once a mentor has been introduced, the group is asked every morning when
 * they would like their first class, until SYNC has a meeting for the group.
 * SYNC is the only place classes are booked, so its `meetings` table is the
 * only honest signal that the question has been answered -- asking the family
 * to confirm in WhatsApp would just be a second thing to chase.
 *
 * The rules, in the order they are applied to a group's meetings:
 *
 *   - **none at all** -> ask.
 *   - **four or more** -> stop, and don't check whose they are. A group with
 *     that many meetings is plainly running; whatever the mentor history is,
 *     it is not something a morning message to the family will fix.
 *   - **one to three** -> check whose they are. SYNC's group_id is reused
 *     across a group's whole life, so a handful of meetings can belong to a
 *     previous mentor. If any of them is the mentor this case assigned, the
 *     first class is genuinely booked: stop for good. If none is, they are
 *     somebody else's and the ask continues.
 *
 * Cancelled meetings count, deliberately -- see listMeetingsForGroup.
 *
 * "Stop for good" is a stamp on the case (first_class_confirmed_at), so a
 * group that has been resolved is never re-examined against SYNC again.
 */

export interface FirstClassSummary {
  /** Introduced cases with no meeting recorded yet. */
  open: number;
  prompted: number;
  /** Cases that stopped being asked this pass, because a meeting was found. */
  confirmed: number;
  /** Asked for long enough that Slack was told. */
  escalated: number;
  skipped: number;
  errors: number;
}

/** Meetings at or above this count end the chase without a mentor check. */
const ESTABLISHED_MEETINGS = 4;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** The assigned mentor's number, directory first then SYNC. */
async function assignedMentorPhone(groupCase: db.GroupCase): Promise<string> {
  if (groupCase.mentorName) {
    const match = findMentor(groupCase.mentorName);
    if (match.status === 'matched') {
      const digits = sync.phoneDigits(match.best!.item.phone ?? '');
      if (digits) return digits;
    }
  }
  if (groupCase.mentorSyncUserId) {
    const user = await sync.findUserById(groupCase.mentorSyncUserId);
    if (user) return sync.phoneDigits(user.phone_number ?? '');
  }
  return '';
}

/**
 * Is one of these meetings the assigned mentor's?
 *
 * By SYNC id where the case has one, and otherwise by looking each distinct
 * mentor_id up in SYNC's users and comparing phone numbers -- which is what
 * the older cases, assigned before mentor_sync_user_id existed, need.
 */
async function meetingsBelongToMentor(
  groupCase: db.GroupCase,
  meetings: sync.Meeting[]
): Promise<{ matched: boolean; reason: string }> {
  const mentorIds = [...new Set(meetings.map((m) => m.mentor_id).filter((id): id is string => !!id))];
  if (mentorIds.length === 0) {
    return { matched: false, reason: 'the meetings on this group name no mentor' };
  }

  if (groupCase.mentorSyncUserId && mentorIds.includes(groupCase.mentorSyncUserId)) {
    return { matched: true, reason: `a meeting is booked with ${groupCase.mentorName} (matched on SYNC id)` };
  }

  const wanted = await assignedMentorPhone(groupCase);
  if (!wanted) {
    return {
      matched: false,
      reason: `no phone number for ${groupCase.mentorName ?? 'the assigned mentor'} to check the meetings against`,
    };
  }

  for (const id of mentorIds) {
    const user = await sync.findUserById(id);
    if (user && sync.phoneDigits(user.phone_number ?? '') === wanted) {
      return { matched: true, reason: `a meeting is booked with ${groupCase.mentorName} (matched on phone number)` };
    }
  }
  return {
    matched: false,
    reason: `the ${meetings.length} meeting(s) on this group belong to another mentor`,
  };
}

/** Has a whole day passed since this group was last asked? */
function askedToday(groupCase: db.GroupCase): boolean {
  const last = groupCase.firstClassPromptedAt;
  if (!last) return false;
  return Date.now() - last.getTime() < 20 * 60 * 60 * 1000;
}

async function runOne(
  groupCase: db.GroupCase,
  summary: FirstClassSummary
): Promise<boolean> {
  const groupId = groupCase.supabaseGroupId;
  if (!groupId) {
    summary.skipped += 1;
    return false;
  }

  const meetings = await sync.listMeetingsForGroup(groupId);

  if (meetings.length >= ESTABLISHED_MEETINGS) {
    await db.updateCase(groupCase.id, {
      firstClassConfirmedAt: new Date(),
      firstClassConfirmedReason: `${meetings.length} meetings on this group -- already running`,
    });
    summary.confirmed += 1;
    console.log(`[case ${groupCase.id}] ${meetings.length} meetings -- no longer asking`);
    return false;
  }

  if (meetings.length > 0) {
    const { matched, reason } = await meetingsBelongToMentor(groupCase, meetings);
    if (matched) {
      await db.updateCase(groupCase.id, {
        firstClassConfirmedAt: new Date(),
        firstClassConfirmedReason: reason,
      });
      summary.confirmed += 1;
      console.log(`[case ${groupCase.id}] ${reason} -- no longer asking`);
      return false;
    }
    console.log(`[case ${groupCase.id}] ${reason} -- still asking`);
  }

  // A redeploy restarts the cron, so this is what stops a second copy of the
  // question landing in the group the same morning.
  if (askedToday(groupCase)) {
    summary.skipped += 1;
    return false;
  }

  if (!groupCase.mentorName) {
    summary.skipped += 1;
    console.warn(`[case ${groupCase.id}] no mentor name to address the message to`);
    return false;
  }

  await periskope.sendMessage(
    groupCase.chatId,
    templates.firstClassPrompt({
      studentName: groupCase.studentName,
      mentorName: groupCase.mentorName,
    })
  );

  const now = new Date();
  const startedAt = groupCase.firstClassFirstPromptedAt ?? now;
  await db.updateCase(groupCase.id, {
    firstClassPromptedAt: now,
    firstClassPromptCount: groupCase.firstClassPromptCount + 1,
    ...(groupCase.firstClassFirstPromptedAt ? {} : { firstClassFirstPromptedAt: now }),
  });
  summary.prompted += 1;

  // Asked for long enough that nobody is going to answer on their own. Told to
  // Slack once, in the case's own thread, and the asking continues.
  const escalateAfter = config.firstClass.escalateAfterDays * 24 * 60 * 60 * 1000;
  const overdue = now.getTime() - startedAt.getTime() >= escalateAfter;
  if (overdue && !groupCase.firstClassEscalatedAt && groupCase.slackChannel && groupCase.slackThreadTs) {
    const days = Math.floor((now.getTime() - startedAt.getTime()) / (24 * 60 * 60 * 1000));
    await slack.postMessage({
      text:
        `:calendar: *${groupCase.groupName}* still has no meeting on SYNC ${days} days after ` +
        `${groupCase.mentorName} was introduced. The group has been asked ` +
        `${groupCase.firstClassPromptCount + 1} times and is still being asked daily.`,
      channel: groupCase.slackChannel,
      threadTs: groupCase.slackThreadTs,
    });
    await db.updateCase(groupCase.id, { firstClassEscalatedAt: now });
    summary.escalated += 1;
  }

  return true;
}

/** One morning's pass over every introduced case with no meeting yet. */
export async function runFirstClassChase(): Promise<FirstClassSummary> {
  const summary: FirstClassSummary = {
    open: 0,
    prompted: 0,
    confirmed: 0,
    escalated: 0,
    skipped: 0,
    errors: 0,
  };

  const open = await db.listCasesAwaitingFirstClass();
  summary.open = open.length;

  for (const groupCase of open) {
    try {
      const sent = await runOne(groupCase, summary);
      // Pace the sends the same way the action queue does, so a morning's
      // worth of groups isn't messaged in one burst.
      if (sent) await sleep(config.queue.gapSeconds * 1000);
    } catch (err) {
      summary.errors += 1;
      console.error(`[case ${groupCase.id}] first-class chase failed:`, err);
    }
  }
  return summary;
}
