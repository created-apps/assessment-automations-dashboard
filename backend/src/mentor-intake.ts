import * as db from './db';
import * as sync from './sync';
import { findMentor, findMentorByEmail, type Mentor } from './mentors';
import type { SheetRowValues } from './sheets';

/**
 * The intake sheet as a way of naming a group's mentor.
 *
 * Ops fill the mentor's name and email into the row at the same time as the
 * brainstorm outcome, so the sheet-sync pass reads them off the same values it
 * is already holding and lines the introduction up. Nothing is sent here: the
 * introduction goes on the end of the case's queue, and the queue runner sends
 * it once the family has joined and the welcome has gone out -- which is also
 * why a case still at AWAITING_JOIN is queued rather than skipped.
 *
 * Two lookups have to agree before anything is queued, and they answer
 * different questions:
 *
 *  - **The directory** (mentors.json + the `mentors` table) is where the
 *    introduction text lives. No entry means there is nothing to send, so the
 *    row is left alone until someone adds the mentor properly in the
 *    dashboard. Matched on email first, then by the same fuzzy name match the
 *    dashboard uses.
 *
 *  - **SYNC** is what every step after the introduction points at: the group
 *    membership, the invite DM, the mentor's Drive access. A mentor SYNC does
 *    not know would get an introduction and nothing else, so that too waits --
 *    a later tick picks the row up once their account exists.
 *
 * Neither miss is an error worth waking anyone for: both are logged and the
 * row is simply reconsidered on the next pass. Nothing is written to say we
 * warned, so nothing has to be cleaned up when the sheet is fixed.
 */

export interface MentorIntakeSummary {
  /** Rows naming a mentor on a case that hasn't got one. */
  considered: number;
  queued: number;
  /** Rows left for a later tick: no directory entry, or SYNC doesn't know them. */
  unresolved: number;
  errors: number;
}

export const emptySummary = (): MentorIntakeSummary => ({
  considered: 0,
  queued: 0,
  unresolved: 0,
  errors: 0,
});

/**
 * The SYNC mentor directory, read once per pass.
 *
 * Read lazily: a run where no row names a new mentor -- the normal case --
 * doesn't call SYNC at all.
 */
export class SyncDirectory {
  private mentors: sync.ResolvedMentor[] | null = null;

  async load(): Promise<sync.ResolvedMentor[]> {
    if (!this.mentors) this.mentors = await sync.listMentors();
    return this.mentors;
  }
}

/** Has this case already had a mentor dealt with, one way or another? */
function alreadyHandled(
  entry: db.SheetSyncCase,
  mentorQueued: Set<string>
): boolean {
  return (
    entry.stage === 'MENTOR_ASSIGNED' ||
    entry.mentorIntroSentAt !== null ||
    entry.mentorName !== null ||
    mentorQueued.has(entry.caseId)
  );
}

/**
 * The directory entry to introduce, or null with the reason it can't be found.
 *
 * Email is tried first because it is copied rather than typed; the fuzzy name
 * match is the same one a dashboard user gets, so a sheet reading "Aash Sha"
 * still finds "Aash Shah".
 */
function directoryEntry(
  row: SheetRowValues
): { mentor: Mentor } | { mentor: null; reason: string } {
  const byEmail = findMentorByEmail(row.mentorEmail);
  if (byEmail) return { mentor: byEmail };

  const match = findMentor(row.mentorName);
  if (match.status === 'matched') return { mentor: match.best!.item };

  const suggestions = match.candidates
    .filter((c) => c.score > 0)
    .map((c) => c.item.name)
    .slice(0, 3);
  const nearest = suggestions.length ? ` (nearest: ${suggestions.join(', ')})` : '';
  return {
    mentor: null,
    reason:
      match.status === 'ambiguous'
        ? `"${row.mentorName}" could be any of several mentors in the directory${nearest}`
        : `no mentor in the directory matches "${row.mentorName}"` +
          (row.mentorEmail ? ` or ${row.mentorEmail}` : '') +
          nearest,
  };
}

/**
 * Will the introduction's SYNC side-effects actually work?
 *
 * Deliberately the same two steps addMentor takes when it sends: the stored
 * SYNC id if the mentor was added from the dashboard, otherwise an exact name
 * match. Matching on email here instead would pass a mentor whose SYNC account
 * is under a different spelling -- the send would still fail to link them, and
 * the family would have had the introduction by then.
 *
 * Which is what makes the email worth reading anyway: when the name path finds
 * nothing and the email finds someone, that gap is the actual problem, and the
 * log says so rather than "no mentor account".
 */
async function resolveOnSync(
  mentor: Mentor,
  row: SheetRowValues,
  directory: SyncDirectory
): Promise<{ resolved: true } | { resolved: false; reason: string }> {
  const mentors = await directory.load();

  if (mentor.syncUserId && mentors.some((m) => m.id === mentor.syncUserId)) {
    return { resolved: true };
  }

  const byName = sync.matchMentor(mentors, { name: mentor.name });
  if (byName.status === 'matched') return { resolved: true };
  if (byName.status === 'ambiguous') {
    return {
      resolved: false,
      reason: `${byName.count} SYNC mentors are named "${mentor.name}"`,
    };
  }

  const byEmail = sync.matchMentor(mentors, {
    email: mentor.email || row.mentorEmail,
  });
  if (byEmail.status === 'matched') {
    return {
      resolved: false,
      reason:
        `SYNC has that email under the name "${byEmail.mentor.name}", not ` +
        `"${mentor.name}" -- the introduction would go out with no group ` +
        `membership, invite DM or Drive access. Line the two spellings up, or ` +
        `re-add the mentor from the dashboard so their SYNC id is stored`,
    };
  }

  return {
    resolved: false,
    reason: `SYNC has no mentor account for "${mentor.name}"`,
  };
}

/**
 * Consider one sheet row's mentor, and queue the introduction if everything
 * lines up.
 *
 * Never throws: the caller is mid-pass over every case, and a mentor that
 * couldn't be worked out must not cost the project-details sync for this row
 * or any row after it.
 */
export async function considerRow(
  entry: db.SheetSyncCase,
  row: SheetRowValues,
  directory: SyncDirectory,
  mentorQueued: Set<string>,
  summary: MentorIntakeSummary
): Promise<void> {
  // A blank cell is not an instruction, and neither is a mentor on a case that
  // already has one -- whoever assigned it did so more recently than this row.
  if (!row.mentorName && !row.mentorEmail) return;
  if (alreadyHandled(entry, mentorQueued)) return;

  summary.considered += 1;

  const named = row.mentorName || row.mentorEmail;
  const label = `[${entry.caseId}] sheet row ${entry.sheetRow} names mentor "${named}"`;

  try {
    const found = directoryEntry(row);
    if (!found.mentor) {
      summary.unresolved += 1;
      console.warn(`${label}: ${found.reason} -- not queued`);
      return;
    }
    const mentor = found.mentor;

    // SYNC has to know them before the introduction goes out; see the note at
    // the top of this file.
    if (!sync.syncConfigured()) {
      summary.unresolved += 1;
      console.warn(`${label}: SYNC is not configured, so mentor intake is skipped`);
      return;
    }

    const onSync = await resolveOnSync(mentor, row, directory);
    if (!onSync.resolved) {
      summary.unresolved += 1;
      console.warn(`${label}: ${onSync.reason} -- not queued, will be retried`);
      return;
    }

    // Queued under the directory's own name so the send-time lookup is an
    // exact hit rather than a second fuzzy match against the sheet's spelling.
    const queued = await db.enqueueAction(entry.caseId, {
      kind: 'ADD_MENTOR',
      params: { mentor: mentor.name },
      queuedBy: 'intake sheet',
    });
    // Same run, later row, same case: don't let it queue a second one.
    mentorQueued.add(entry.caseId);
    summary.queued += 1;
    console.log(
      `${label}: introduction for ${mentor.name} queued at position ` +
        `${queued.position} for ${entry.groupName}` +
        (entry.stage === 'AWAITING_JOIN' ? ' (held until the welcome goes out)' : '')
    );
  } catch (err) {
    summary.errors += 1;
    console.error(`${label}: mentor intake failed:`, err);
  }
}
