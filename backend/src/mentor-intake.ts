import * as db from './db';
import * as sync from './sync';
import * as slack from './slack';
import * as templates from './templates';
import {
  findMentorByEmail,
  findMentorFuzzy,
  sameMentorName,
  type Mentor,
} from './mentors';
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
  /** Unresolvable mentors reported in Slack on this pass. */
  alerted: number;
  errors: number;
}

export const emptySummary = (): MentorIntakeSummary => ({
  considered: 0,
  queued: 0,
  unresolved: 0,
  alerted: 0,
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

/** A directory lookup that failed, with everything Slack needs to say so. */
interface NotFound {
  mentor: null;
  reason: string;
  suggestions: string[];
}

/** The three nearest directory names, for a "did you mean". */
function nearest(match: { candidates: { item: Mentor; score: number }[] }): string[] {
  return match.candidates
    .filter((c) => c.score > 0)
    .map((c) => c.item.name)
    .slice(0, 3);
}

/**
 * The directory entry to introduce, or null with the reason it can't be found.
 *
 * The two columns are held to deliberately different standards, because they
 * are produced in different ways:
 *
 *  - **Email is exact.** It is copied, not typed, so a near miss is not a
 *    typo -- it is a different address, and an address either belongs to a
 *    mentor or it does not. Nothing is fuzzy here and nothing ever should be:
 *    "close" email matching is how a family gets introduced to the wrong
 *    person with the audit trail saying it was deliberate.
 *
 *  - **Name is fuzzy.** It is typed into a spreadsheet cell by hand, so it
 *    carries misspellings, shortenings and honorifics. findMentorFuzzy still
 *    refuses to guess below the confidence threshold or between two close
 *    candidates.
 *
 * When both resolve, they must resolve to the same mentor. A row whose email
 * says one person and whose name says another is not a lookup problem to be
 * broken in the email's favour -- it is a wrong row, and only a human knows
 * which half of it is the mistake.
 */
interface Found {
  mentor: Mentor;
  /**
   * How it was resolved. 'fuzzy-name' is the only one that involved a
   * judgement call, and is the only one the thread is told about.
   */
  via: 'email' | 'exact-name' | 'fuzzy-name';
}

function directoryEntry(row: SheetRowValues): Found | NotFound {
  const email = (row.mentorEmail ?? '').trim();
  const name = (row.mentorName ?? '').trim();

  const byEmail = email ? findMentorByEmail(email) : null;
  const byName = name ? findMentorFuzzy(name) : null;
  const named = byName?.status === 'matched' ? byName.best!.item : null;

  if (byEmail) {
    if (named && !sameMentorName(named.name, byEmail.name)) {
      return {
        mentor: null,
        suggestions: [byEmail.name, named.name],
        reason:
          `the email belongs to ${byEmail.name} while the name reads as ` +
          `${named.name} -- two different mentors, so this cannot say which ` +
          `was meant`,
      };
    }
    return { mentor: byEmail, via: 'email' };
  }

  // No email hit. Say so explicitly when one was given: "the name didn't
  // match" is a different problem from "the address isn't one we hold", and
  // whoever fixes the row needs to know which.
  const emailNote = email
    ? `no mentor in the directory has the email ${email}`
    : '';

  if (named) {
    return {
      mentor: named,
      via: sameMentorName(named.name, name) ? 'exact-name' : 'fuzzy-name',
    };
  }

  if (!name) {
    return {
      mentor: null,
      suggestions: [],
      reason: emailNote || 'the row names no mentor',
    };
  }

  const suggestions = byName ? nearest(byName) : [];
  const nameNote =
    byName?.status === 'ambiguous'
      ? `"${name}" is too close to more than one mentor to choose between them`
      : `no mentor in the directory is named "${name}"`;

  return {
    mentor: null,
    suggestions,
    reason: emailNote ? `${emailNote}, and ${nameNote}` : nameNote,
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
 * What this row said that could not be resolved, normalised.
 *
 * Stored on the case so the same bad value is reported once rather than every
 * hour. Both columns go into it: correcting the name while leaving a wrong
 * email is still a row that needs reporting, and it would look identical to a
 * key built from either column alone.
 */
function alertKey(row: SheetRowValues): string {
  const name = (row.mentorName ?? '').trim().replace(/\s+/g, ' ').toLowerCase();
  const email = (row.mentorEmail ?? '').trim().toLowerCase();
  return `${name}|${email}`;
}

/**
 * Say in Slack that this row's mentor cannot be found.
 *
 * In the case's own thread when it has one. A case still at AWAITING_JOIN has
 * no thread yet -- the thread is opened by the handover, after the family
 * joins -- so those fall back to the channel, where the message still names
 * the group and the sheet row.
 *
 * Posts before recording the key, so a Slack outage means the row is reported
 * on the next pass rather than silently marked as reported. Never throws: an
 * unreachable Slack must not cost this row its retry, or the rows behind it
 * their project-details sync.
 */
async function reportUnresolved(
  entry: db.SheetSyncCase,
  row: SheetRowValues,
  found: NotFound,
  summary: MentorIntakeSummary
): Promise<void> {
  const key = alertKey(row);
  // Same bad value as last time: already said, and saying it again hourly is
  // how the alert stops being read.
  if (entry.mentorAlertKey === key) return;

  try {
    await slack.postMessage({
      text: templates.mentorNotFound({
        caseId: entry.caseId,
        groupName: entry.groupName,
        studentName: entry.studentName,
        sheetRow: entry.sheetRow,
        mentorName: (row.mentorName ?? '').trim(),
        mentorEmail: (row.mentorEmail ?? '').trim(),
        reason: found.reason,
        suggestions: found.suggestions,
      }),
      ...(entry.slackChannel && entry.slackThreadTs
        ? { channel: entry.slackChannel, threadTs: entry.slackThreadTs }
        : {}),
    });

    await db.updateCase(entry.caseId, {
      mentorAlertKey: key,
      mentorAlertAt: new Date(),
    });
    // So a second row in the same pass doesn't post the same thing again.
    entry.mentorAlertKey = key;
    summary.alerted += 1;
  } catch (err) {
    console.error(
      `[${entry.caseId}] could not report the unresolved mentor in Slack:`,
      err
    );
  }
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
      await reportUnresolved(entry, row, found, summary);
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

    // The row was reported at some point and has since been fixed. Clearing
    // the key means a future break is reported afresh rather than silently
    // matching a complaint from weeks ago.
    if (entry.mentorAlertKey) {
      await db.updateCase(entry.caseId, {
        mentorAlertKey: null,
        mentorAlertAt: null,
      });
    }

    // A judgement call was made about who this row meant. Say so while the
    // introduction is still only queued. Best-effort: the introduction is
    // already lined up and a Slack outage must not undo that.
    if (found.via === 'fuzzy-name') {
      await slack
        .postMessage({
          text: templates.mentorMatchedLoosely({
            caseId: entry.caseId,
            groupName: entry.groupName,
            typed: (row.mentorName ?? '').trim(),
            matched: mentor.name,
          }),
          ...(entry.slackChannel && entry.slackThreadTs
            ? { channel: entry.slackChannel, threadTs: entry.slackThreadTs }
            : {}),
        })
        .catch((err) =>
          console.error(`[${entry.caseId}] could not report the loose match:`, err)
        );
    }

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
