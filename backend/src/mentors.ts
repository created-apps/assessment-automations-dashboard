import { config } from './config';
import { matchName, type MatchResult } from './match';
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

export type MentorMatch = MatchResult<Mentor>;

export function findMentor(query: string): MentorMatch {
  return matchName(query, allMentors(), (m) => m.name, {
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
