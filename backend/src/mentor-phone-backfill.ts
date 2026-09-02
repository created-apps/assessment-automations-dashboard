import { config } from './config';
import * as db from './db';
import * as sync from './sync';
import { matchName, normalize } from './match';
import seedDirectory from './data/mentors.json';
import type { Mentor } from './mentors';

/**
 * Pull mentor phone numbers out of SYNC and into our own `mentors` table.
 *
 * The two services push the other way round -- a mentor added in the dashboard
 * is written here and then given a SYNC account (mentor-sync.ts) -- so the
 * mentors who predate that flow have a phone number on SYNC and none here. A
 * number is needed locally to answer "is this mentor already in the group?"
 * without a round trip to SYNC on every check, so this fills the gap once and
 * stores it.
 *
 * Two kinds of row come out of a pass:
 *
 *   - a `mentors` row with no phone      -> patched with SYNC's number
 *   - a JSON-seed mentor with no row     -> a row inserted carrying the seed's
 *                                           introduction plus SYNC's number
 *
 * The seed insert is the same override the dashboard writes when a seed
 * mentor's intro is edited, so the merged directory in mentors.ts is unchanged
 * by it -- it just gains the contact details.
 *
 * Nothing is guessed. A mentor SYNC has under a different spelling is matched
 * fuzzily only when one candidate stands clearly alone; anything short of that
 * is reported unresolved for a human rather than given someone else's number.
 */

const seedMentors = seedDirectory as Mentor[];

/** Exact-match threshold for the fuzzy fallback. Deliberately stricter than
 *  the Slack matcher's: nobody is watching this run, and the cost of a wrong
 *  match is a mentor's phone number attached to the wrong person. */
const FUZZY_MIN_SCORE = 0.9;

/**
 * Mentors SYNC holds under a name too different for the matcher to reach, each
 * one confirmed by hand against their SYNC email before being written here.
 *
 * The map exists so a re-run reaches the same mentor rather than depending on
 * a score that sits near the threshold -- "Vedant" scores 0.899 against
 * "Vedant Aware" and would otherwise flip on any change to the scorer.
 *
 * Keyed by our normalised name (see normName), valued by SYNC's spelling.
 */
const SYNC_NAME_ALIASES = new Map<string, string>([
  // sankarb.created@gmail.com
  ['sankar b', 'Sankar Balasubramanium'],
  // amaljude22@iitk.ac.in -- SYNC has the two halves of the name swapped.
  ['amal jude ashwin', 'Ashwin Jude'],
  // pvnkmr.1988@gmail.com -- SYNC drops the initials.
  ['pavan kumar k r', 'Pavan Kumar'],
  // kushalchandariit@gmail.com
  ['kushal mylavarapu', 'Kushal chandar'],
  // awarevedant2005@gmail.com -- the seed has only the first name.
  ['vedant', 'Vedant Aware'],
]);

const normName = (raw: string): string => normalize(raw).join(' ');
const normEmail = (raw: string | null | undefined): string =>
  (raw ?? '').trim().toLowerCase();

export type SyncMatch =
  | { status: 'matched'; user: sync.ResolvedMentor; how: 'email' | 'alias' | 'name' | 'fuzzy'; score: number }
  | { status: 'none' }
  | { status: 'ambiguous'; candidates: string[] };

/**
 * The SYNC mentor this directory entry is, if it can be said for certain.
 *
 * Email first (it is copied, not retyped), then a hand-confirmed alias, then
 * the normalised name, then a fuzzy pass for the near misses. The alias sits
 * above the name and the fuzzy pass so a confirmed pairing is never re-decided
 * by a score.
 */
export function matchSyncMentor(
  mentor: { name: string; email?: string | null },
  syncMentors: sync.ResolvedMentor[]
): SyncMatch {
  const email = normEmail(mentor.email);
  if (email) {
    const byEmail = syncMentors.filter((u) => normEmail(u.email) === email);
    if (byEmail.length === 1) return { status: 'matched', user: byEmail[0]!, how: 'email', score: 1 };
    if (byEmail.length > 1) {
      return { status: 'ambiguous', candidates: byEmail.map((u) => u.name) };
    }
  }

  const name = normName(mentor.name);
  if (!name) return { status: 'none' };

  const alias = SYNC_NAME_ALIASES.get(name);
  if (alias) {
    const wanted = normName(alias);
    const byAlias = syncMentors.filter((u) => normName(u.name) === wanted);
    if (byAlias.length === 1) return { status: 'matched', user: byAlias[0]!, how: 'alias', score: 1 };
    // The alias no longer names anyone on SYNC (renamed, or removed). Say so
    // rather than falling through to a fuzzy guess the alias was added to stop.
    return { status: 'ambiguous', candidates: [`alias "${alias}" matched ${byAlias.length} SYNC mentors`] };
  }

  const byName = syncMentors.filter((u) => normName(u.name) === name);
  if (byName.length === 1) return { status: 'matched', user: byName[0]!, how: 'name', score: 1 };
  if (byName.length > 1) {
    return { status: 'ambiguous', candidates: byName.map((u) => u.name) };
  }

  const fuzzy = matchName(mentor.name, syncMentors, (u) => u.name, {
    minScore: FUZZY_MIN_SCORE,
    ambiguityMargin: config.mentors.ambiguityMargin,
  });
  if (fuzzy.status === 'matched' && fuzzy.best) {
    return { status: 'matched', user: fuzzy.best.item, how: 'fuzzy', score: fuzzy.best.score };
  }
  if (fuzzy.status === 'ambiguous') {
    return { status: 'ambiguous', candidates: fuzzy.candidates.map((c) => c.item.name) };
  }
  return { status: 'none' };
}

/** One thing the backfill would do, or did. */
export interface PhonePlanItem {
  name: string;
  /** 'patch' fills a row that exists; 'insert' gives a seed mentor its row. */
  action: 'patch' | 'insert';
  phone: string;
  email: string | null;
  syncUserId: string;
  how: 'email' | 'alias' | 'name' | 'fuzzy';
  /** The SYNC spelling, when it differs from ours -- worth seeing in the log. */
  syncName: string;
  mentorId?: string;
  error?: string;
}

/** A mentor no number could be stored for, and why. */
export interface PhoneSkip {
  name: string;
  reason: 'no-sync-match' | 'ambiguous' | 'sync-has-no-phone';
  detail?: string;
}

export interface PhoneBackfillSummary {
  /** Directory entries considered (DB rows + JSON seed, deduped by name). */
  considered: number;
  /** Already had a number here; left alone. */
  alreadyHadPhone: number;
  planned: PhonePlanItem[];
  skipped: PhoneSkip[];
  patched: number;
  inserted: number;
  failed: PhonePlanItem[];
}

/**
 * Work out what a pass would write, without writing it.
 *
 * Split from the apply step so the CLI can show the plan first: attaching a
 * phone number to the wrong mentor is not something a later pass would undo.
 */
export async function planPhoneBackfill(): Promise<PhoneBackfillSummary> {
  if (!sync.syncConfigured()) {
    throw new Error('SYNC is not configured -- set SYNC_SUPABASE_URL and SYNC_SUPABASE_SERVICE_KEY');
  }

  const [syncMentors, dbMentors] = await Promise.all([sync.listMentors(), db.listDbMentors()]);

  const summary: PhoneBackfillSummary = {
    considered: 0,
    alreadyHadPhone: 0,
    planned: [],
    skipped: [],
    patched: 0,
    inserted: 0,
    failed: [],
  };

  const dbByName = new Map(dbMentors.map((m) => [m.name.trim().toLowerCase(), m]));

  // DB rows first, then the seed entries that have no row -- the same
  // precedence mentors.ts merges them with.
  const seedOnly = seedMentors.filter((m) => !dbByName.has(m.name.trim().toLowerCase()));

  for (const mentor of dbMentors) {
    summary.considered += 1;
    if (mentor.phone && sync.phoneDigits(mentor.phone)) {
      summary.alreadyHadPhone += 1;
      continue;
    }
    const match = matchSyncMentor(mentor, syncMentors);
    const item = toPlanItem(mentor.name, 'patch', match, summary);
    if (item) summary.planned.push({ ...item, mentorId: mentor.id });
  }

  for (const mentor of seedOnly) {
    summary.considered += 1;
    const match = matchSyncMentor(mentor, syncMentors);
    const item = toPlanItem(mentor.name, 'insert', match, summary);
    if (item) summary.planned.push(item);
  }

  return summary;
}

/** Turn a match into a plan item, or record why it isn't one. */
function toPlanItem(
  name: string,
  action: 'patch' | 'insert',
  match: SyncMatch,
  summary: PhoneBackfillSummary
): PhonePlanItem | null {
  if (match.status === 'none') {
    summary.skipped.push({ name, reason: 'no-sync-match' });
    return null;
  }
  if (match.status === 'ambiguous') {
    summary.skipped.push({ name, reason: 'ambiguous', detail: match.candidates.join(', ') });
    return null;
  }
  // SYNC's phone_number is NOT NULL but a couple of rows hold a placeholder
  // ("unknown-<name>") from an import, which is not a number.
  if (!match.user.phone || !sync.phoneDigits(match.user.phone)) {
    summary.skipped.push({
      name,
      reason: 'sync-has-no-phone',
      detail: match.user.phone ?? undefined,
    });
    return null;
  }
  return {
    name,
    action,
    phone: match.user.phone,
    email: match.user.email,
    syncUserId: match.user.id,
    how: match.how,
    syncName: match.user.name.replace(/\s+/g, ' ').trim(),
  };
}

/**
 * Apply a plan. Each row is written on its own -- one failure (a name that
 * races the dashboard into the unique index, say) leaves the rest done.
 */
export async function applyPhoneBackfill(
  summary: PhoneBackfillSummary
): Promise<PhoneBackfillSummary> {
  const seedByName = new Map(seedMentors.map((m) => [m.name.trim().toLowerCase(), m]));

  for (const item of summary.planned) {
    try {
      if (item.action === 'patch') {
        await db.updateMentorContact(item.mentorId!, {
          phone: item.phone,
          email: item.email,
          syncUserId: item.syncUserId,
        });
        summary.patched += 1;
      } else {
        const seed = seedByName.get(item.name.trim().toLowerCase());
        if (!seed) throw new Error('seed entry disappeared between plan and apply');
        const row = await db.insertMentor({
          name: seed.name,
          intro: seed.intro,
          variants: seed.variants ?? null,
          email: item.email,
          phone: item.phone,
          createdBy: 'mentor-phone-backfill',
        });
        await db.updateMentorSync(row.id, { syncUserId: item.syncUserId, syncError: null });
        summary.inserted += 1;
      }
    } catch (err) {
      item.error = err instanceof Error ? err.message : String(err);
      summary.failed.push(item);
    }
  }
  return summary;
}
