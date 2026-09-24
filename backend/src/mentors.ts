import { matchName, type MatchResult } from './match';
import { config } from './config';
import directory from './data/mentors.json';
import { listDbMentors, type DbMentor } from './db';

/**
 * The mentor introductions.
 *
 * The roster started life as a static file (data/mentors.json, lifted from
 * "Mentor Descriptions.pdf"). Mentors added from the dashboard live in the
 * `mentors` table instead, and are merged on top of the seed here so both the
 * picker and the name matcher see them without a redeploy. `intro` is what goes
 * out unless a variant is asked for by name.
 */
export interface Mentor {
  name: string;
  intro: string;
  variants?: Record<string, string>;
  email?: string | null;
  phone?: string | null;
  /**
   * Their SYNC users.id. Only dashboard-added mentors have one -- the JSON
   * seed predates it -- so every consumer still falls back to matching on
   * name when it is absent.
   */
  syncUserId?: string | null;
}

const seedMentors: Mentor[] = directory as Mentor[];

// DB-backed additions, cached in memory and refreshed by refreshMentors(). Kept
// in a module-level array so findMentor() can stay synchronous (it is called on
// the preview path, which is not async).
let dbMentors: Mentor[] = [];

function fromDb(m: DbMentor): Mentor {
  return {
    name: m.name,
    intro: m.intro,
    ...(m.variants ? { variants: m.variants } : {}),
    email: m.email,
    phone: m.phone,
    syncUserId: m.syncUserId,
  };
}

/** Seed + DB, deduped by normalised name (a DB row overrides a seed entry). */
export function allMentors(): Mentor[] {
  const byName = new Map<string, Mentor>();
  for (const m of seedMentors) byName.set(m.name.trim().toLowerCase(), m);
  for (const m of dbMentors) byName.set(m.name.trim().toLowerCase(), m);
  return [...byName.values()];
}

/**
 * Reload the DB-backed mentors into the cache. Called at startup, on a timer,
 * and right after a mentor is added. Safe to call before the table exists (the
 * migration may not have been run yet): it logs and keeps the seed-only list.
 */
export async function refreshMentors(): Promise<void> {
  try {
    dbMentors = (await listDbMentors()).map(fromDb);
  } catch (err) {
    console.error(
      'could not load mentors from the database (using seed only):',
      err instanceof Error ? err.message : err
    );
  }
}

/**
 * A mentor name reduced to the only differences that aren't differences:
 * case, surrounding space, runs of whitespace, and Unicode composition.
 *
 * Nothing else is touched. Honorifics, initials, punctuation and spelling all
 * count -- "Dr. Aash Shah" is not "Aash Shah", and a mentor is found by the
 * name the directory holds or not at all.
 */
const normName = (raw: string): string =>
  (raw ?? '').normalize('NFKC').replace(/\s+/g, ' ').trim().toLowerCase();

/** Do these two spellings name the same directory entry? */
export function sameMentorName(a: string, b: string): boolean {
  const left = normName(a);
  return left.length > 0 && left === normName(b);
}

/**
 * The directory entry holding this email, or null.
 *
 * Exact against the address stored on the mentor: an email is either theirs or
 * it isn't. Only case and surrounding space are ignored, which every mail
 * system already ignores. Two entries sharing an address is treated as no
 * match rather than picked between.
 */
export function findMentorByEmail(email: string): Mentor | null {
  const wanted = (email ?? '').trim().toLowerCase();
  if (!wanted) return null;
  const matches = allMentors().filter(
    (m) => (m.email ?? '').trim().toLowerCase() === wanted
  );
  return matches.length === 1 ? matches[0]! : null;
}

export type MentorMatch = MatchResult<Mentor>;

/**
 * The directory entry with exactly this name.
 *
 * Exact, deliberately. This used to score candidates and accept the best one
 * above a threshold, which meant a misspelling in a sheet or a Slack reply
 * could resolve to a real mentor -- and the cost of resolving to the *wrong*
 * one is a family being introduced to somebody else's mentor, discovered only
 * after the message has been read. A name that does not match is now simply
 * not found, and whoever typed it fixes it.
 *
 * `score` stays in the result purely because MatchResult is shared with the
 * booking-host lookup; here it is always 1, because there is nothing to score.
 */
export function findMentor(query: string): MentorMatch {
  const wanted = normName(query);
  if (!wanted) return { status: 'none', candidates: [] };

  const hits = allMentors().filter((m) => normName(m.name) === wanted);
  const candidates = hits.map((item) => ({ item, score: 1 }));

  if (hits.length === 0) return { status: 'none', candidates: [] };
  // Two directory entries under one name. Nothing here can tell them apart,
  // so it is a question for a person rather than a pick.
  if (hits.length > 1) {
    return { status: 'ambiguous', best: candidates[0], candidates };
  }
  return { status: 'matched', best: candidates[0], candidates };
}

/**
 * The directory entry a hand-typed name most likely means.
 *
 * Unlike findMentor, this scores the candidates and accepts a close-enough
 * winner, so "Aash Sha" still finds "Aash Shah" and "Harshit Sir" still finds
 * "Harshit Rai Verma".
 *
 * It exists for exactly one caller: the Mentor Name column of the intake
 * sheet, which is typed by hand and so carries the misspellings, shortenings
 * and honorifics a person produces. Everywhere else -- the dashboard's picker,
 * the send-time lookup, the mentor-join check -- is reading a name this
 * directory itself produced, where a near miss means something has gone wrong
 * rather than that somebody typed quickly, and those all keep findMentor.
 *
 * An exact hit still wins outright, including an exact hit on a name the
 * directory holds twice: that is a question for a person, and scoring it would
 * only turn it into a silent pick.
 *
 * It refuses to guess on the same terms the scorer always has: below
 * MENTOR_MIN_MATCH_SCORE nothing is returned, and two candidates within
 * MENTOR_AMBIGUITY_MARGIN of each other come back ambiguous. Introducing a
 * family to the wrong mentor is far worse than asking for a spelling again.
 */
export function findMentorFuzzy(query: string): MentorMatch {
  const wanted = (query ?? '').trim();
  if (!wanted) return { status: 'none', candidates: [] };

  const exact = findMentor(wanted);
  if (exact.status !== 'none') return exact;

  return matchName(wanted, allMentors(), (m) => m.name, {
    minScore: config.mentors.minMatchScore,
    ambiguityMargin: config.mentors.ambiguityMargin,
  });
}

/**
 * The introduction to send.
 *
 * `variant` is matched loosely against the variant keys so "chemistry project"
 * still selects the chemistry wording; anything unrecognised falls back to the
 * default introduction rather than failing.
 */
export function introFor(mentor: Mentor, variant?: string): string {
  if (!variant || !mentor.variants) return mentor.intro;

  const wanted = variant.toLowerCase();
  for (const [key, text] of Object.entries(mentor.variants)) {
    if (wanted.includes(key)) return text;
  }
  return mentor.intro;
}
