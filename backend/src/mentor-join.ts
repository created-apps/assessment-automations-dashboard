import * as db from './db';
import * as periskope from './periskope';
import * as sync from './sync';
import { deliverMentorIntro } from './cases';
import { findMentor } from './mentors';

/**
 * The mentor introduction, sent once the mentor is actually in the group.
 *
 * Picking a mentor no longer sends the introduction: it invites them, and
 * parks the introduction on the case (pending_mentor_name). This job runs
 * every five minutes, reads each waiting group's WhatsApp member list, and
 * sends the introduction the first time the mentor appears in it.
 *
 * There is deliberately no timeout and no reminder. A mentor who has not
 * joined shows in the dashboard as "Awaiting mentor join" with the date the
 * wait started, which is where that is meant to be noticed -- the alternative,
 * a daily Slack ping per stalled group, was not wanted.
 */

export interface MentorJoinSummary {
  /** Cases with an introduction waiting to be sent. */
  waiting: number;
  /** Mentors seen in their group this pass, and introduced. */
  introduced: number;
  /** Still not in the group. */
  stillOut: number;
  errors: number;
}

/** The mentor's number: the directory first, then SYNC. */
async function phoneFor(groupCase: db.GroupCase, name: string): Promise<string> {
  const match = findMentor(name);
  if (match.status === 'matched') {
    const digits = sync.phoneDigits(match.best!.item.phone ?? '');
    if (digits) return digits;
  }
  if (groupCase.mentorSyncUserId && sync.syncConfigured()) {
    const user = await sync.findUserById(groupCase.mentorSyncUserId);
    if (user) return sync.phoneDigits(user.phone_number ?? '');
  }
  return '';
}

async function runOne(
  groupCase: db.GroupCase,
  summary: MentorJoinSummary
): Promise<void> {
  const name = groupCase.pendingMentorName;
  if (!name) return;

  // The directory is the source of the introduction text, so a mentor who has
  // been renamed or removed since being picked cannot be introduced. Leave the
  // case waiting rather than sending something wrong.
  const match = findMentor(name);
  if (match.status !== 'matched') {
    summary.errors += 1;
    console.error(
      `[case ${groupCase.id}] pending mentor "${name}" no longer matches one directory entry -- not introduced`
    );
    return;
  }

  const digits = await phoneFor(groupCase, name);
  if (!digits) {
    summary.errors += 1;
    console.error(
      `[case ${groupCase.id}] no phone number for ${name} -- cannot tell whether they joined`
    );
    return;
  }

  const members = await periskope.getChatMemberPhones(groupCase.chatId);
  if (!members.includes(digits)) {
    summary.stillOut += 1;
    return;
  }

  // Stamp the join before sending: if the send throws, the next pass still
  // knows when they actually arrived.
  await db.updateCase(groupCase.id, { mentorJoinedAt: new Date() });

  await deliverMentorIntro(
    groupCase,
    match.best!.item,
    groupCase.pendingMentorVariant ?? undefined,
    groupCase.mentorRequestedName ?? name,
    groupCase.mentorSyncUserId
  );

  summary.introduced += 1;
  console.log(
    `[case ${groupCase.id}] ${name} joined ${groupCase.groupName} -- introduction sent`
  );
}

/** One pass over every case whose introduction is waiting on its mentor. */
export async function runMentorJoinCheck(): Promise<MentorJoinSummary> {
  const summary: MentorJoinSummary = { waiting: 0, introduced: 0, stillOut: 0, errors: 0 };

  const waiting = await db.listCasesAwaitingMentorJoin();
  summary.waiting = waiting.length;

  for (const groupCase of waiting) {
    try {
      await runOne(groupCase, summary);
    } catch (err) {
      summary.errors += 1;
      console.error(`[case ${groupCase.id}] mentor join check failed:`, err);
    }
  }
  return summary;
}
