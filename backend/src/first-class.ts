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
 * One rule, on the count alone:
 *
 *   - **no meetings on the group** -> ask.
 *   - **any meeting at all** -> stop asking, for good.
 *
 * Whose meeting it is deliberately does not matter. This used to check the
 * booking against the case's assigned mentor, on the reasoning that SYNC reuses
 * a group_id for the group's whole life so an old meeting could belong to a
 * previous mentor. In practice that check produced the opposite of what it was
 * for: it kept asking families who had plainly already booked, because the
 * meeting was under a mentor spelling or SYNC id the case didn't carry. A
 * booked group being asked again is the failure worth avoiding, so the count is
 * now the whole test.
 *
 * Cancelled meetings count, deliberately -- see listMeetingsForGroup.
 *
 * "Stop asking" is a stamp on the case (first_class_confirmed_at), so a group
 * that has been resolved is never re-examined against SYNC again.
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

  if (meetings.length > 0) {
    const reason =
      `${meetings.length} meeting(s) on this group in SYNC` +
      ' -- the first class is booked';
    await db.updateCase(groupCase.id, {
      firstClassConfirmedAt: new Date(),
      firstClassConfirmedReason: reason,
    });
    summary.confirmed += 1;
    console.log(`[case ${groupCase.id}] ${reason} -- no longer asking`);
    return false;
  }

  // A redeploy restarts the cron, so this is what stops a second copy of the
  // question landing in the group the same morning.
  if (askedToday(groupCase)) {
    summary.skipped += 1;
    return false;
  }

  // Only mention numbers that are actually in the group. WhatsApp shows a
  // mention of a non-member as the raw digits rather than a name, so anyone
  // who isn't in the group is named instead -- which reads correctly whether
  // or not they are there.
  const members = new Set(await periskope.getChatMemberPhones(groupCase.chatId));
  const studentPhone = sync.phoneDigits(groupCase.studentPhone ?? '');
  const mentorPhone = groupCase.mentorName
    ? await assignedMentorPhone(groupCase)
    : '';

  const prompt = templates.firstClassPrompt({
    student: {
      name: groupCase.studentName,
      phone: members.has(studentPhone) ? studentPhone : null,
    },
    // Named only when the case has a mentor. Asking when the first class
    // should be does not depend on knowing who will teach it.
    ...(groupCase.mentorName
      ? {
          mentor: {
            name: groupCase.mentorName,
            phone: members.has(mentorPhone) ? mentorPhone : null,
          },
        }
      : {}),
  });

  await periskope.sendMessage(groupCase.chatId, prompt.message, {
    mentions: prompt.mentions,
  });

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
        `${groupCase.mentorName ?? 'their mentor'} was introduced. The group has been asked ` +
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
