import * as db from './db';
import * as sync from './sync';

/**
 * Mentors exist in two places: the `mentors` table behind the dashboard's
 * directory, and SYNC's `users`, which is what a group membership, a Drive
 * grant and a COSMIC match all actually point at. Adding a mentor in the
 * dashboard has to produce both.
 *
 * The two writes are not one transaction and shouldn't pretend to be. The
 * local row is written first and always succeeds; the SYNC account is
 * attempted after and, if it fails, is left for the backfill below. SYNC being
 * unreachable is not a reason the team can't add a mentor.
 */

/**
 * Give a mentor a SYNC `users` row and record the result on their row here.
 *
 * Never throws: a failure is stored on the mentor (sync_error) for the
 * backfill to retry and returned as a warning for the operator to see.
 */
export async function ensureMentorOnSync(
  mentor: db.DbMentor
): Promise<{ syncUserId: string | null; warning: string | null }> {
  if (!sync.syncConfigured()) {
    const warning = 'SYNC is not configured, so no SYNC account was created for this mentor.';
    await db.updateMentorSync(mentor.id, { syncError: warning }).catch(() => {});
    return { syncUserId: null, warning };
  }
  if (!mentor.phone) {
    const warning = 'Mentor has no phone number, so no SYNC account could be created.';
    await db.updateMentorSync(mentor.id, { syncError: warning }).catch(() => {});
    return { syncUserId: null, warning };
  }

  try {
    const result = await sync.ensureMentorUser({
      name: mentor.name,
      phone: mentor.phone,
      email: mentor.email,
    });
    await db.updateMentorSync(mentor.id, {
      syncUserId: result.user.id,
      syncError: null,
    });
    const warning =
      result.outcome === 'promoted'
        ? `That number was already on SYNC as a "${result.previousRole}" -- ` +
          `the existing account has been made a mentor rather than duplicated.`
        : null;
    return { syncUserId: result.user.id, warning };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await db.updateMentorSync(mentor.id, { syncError: message.slice(0, 2000) }).catch(() => {});
    return {
      syncUserId: null,
      warning: `The mentor was saved, but their SYNC account could not be created (${message}). It will be retried automatically.`,
    };
  }
}

export interface MentorSyncSummary {
  pending: number;
  created: number;
  failed: number;
}

/**
 * Retry the SYNC accounts that didn't get made when their mentor was added.
 *
 * The working set is mentors with no sync_user_id, which is small and stays
 * small -- a row leaves it the first time SYNC is reachable.
 */
export async function runMentorSyncBackfill(): Promise<MentorSyncSummary> {
  const summary: MentorSyncSummary = { pending: 0, created: 0, failed: 0 };
  if (!sync.syncConfigured()) return summary;

  const pending = await db.listMentorsAwaitingSync();
  summary.pending = pending.length;

  for (const mentor of pending) {
    const { syncUserId } = await ensureMentorOnSync(mentor);
    if (syncUserId) {
      summary.created += 1;
      console.log(`[mentor ${mentor.id}] SYNC account created for ${mentor.name}`);
    } else {
      summary.failed += 1;
    }
  }
  return summary;
}
