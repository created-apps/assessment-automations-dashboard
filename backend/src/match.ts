/**
 * Fuzzy name matching.
 *
 * Names arrive typed by hand into Slack, so they are misspelt, abbreviated
 * ("Harshit Sir"), or carry a title the directory doesn't ("Dr."). Matching has
 * to survive all three while still refusing to guess: a wrong match sends the
 * wrong person's introduction to a parent, which is worse than asking for the
 * name again.
 */

const HONORIFICS = new Set([
  'dr',
  'dr.',
  'mr',
  'mrs',
  'ms',
  'miss',
  'prof',
  'professor',
  'sir',
  'madam',
  'maam',
  'shri',
  'smt',
]);

/** Lowercase, drop punctuation, drop titles. Keeps only the name words. */
export function normalize(raw: string): string[] {
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 0 && !HONORIFICS.has(t));
}

/** Standard Levenshtein distance, two-row variant. */
function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  let curr = new Array<number>(b.length + 1);

  for (let i = 1; i <= a.length; i += 1) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(
        (prev[j] ?? 0) + 1,
        (curr[j - 1] ?? 0) + 1,
        (prev[j - 1] ?? 0) + cost
      );
    }
    [prev, curr] = [curr, prev];
  }

  return prev[b.length] ?? 0;
}

/** 1 for identical strings, 0 for nothing in common. */
function similarity(a: string, b: string): number {
  const longest = Math.max(a.length, b.length);
  if (longest === 0) return 1;
  return 1 - levenshtein(a, b) / longest;
}

/**
 * How well one token matches the best token on the other side.
 *
 * A prefix counts as a full match so "Nirupma" still finds "Nirupma", and so
 * that a shortened first name doesn't get penalised for the letters it drops.
 */
function tokenScore(token: string, against: string[]): number {
  let best = 0;
  for (const other of against) {
    const exact = token === other;
    const prefix =
      token.length >= 3 &&
      (other.startsWith(token) || token.startsWith(other));
    const score = exact ? 1 : prefix ? 0.95 : similarity(token, other);
    if (score > best) best = score;
  }
  return best;
}

function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

/**
 * Score a query against one candidate, 0..1.
 *
 * Weighted towards the query side on purpose: "Harshit" should score highly
 * against "Harshit Rai Verma", because the words the typist left out say
 * nothing about whether they meant that person. The candidate side still gets
 * a quarter of the weight, so a full name beats a bare surname.
 */
export function scoreName(query: string, candidate: string): number {
  const q = normalize(query);
  const c = normalize(candidate);
  if (q.length === 0 || c.length === 0) return 0;

  if (q.join(' ') === c.join(' ')) return 1;

  const forward = mean(q.map((t) => tokenScore(t, c)));
  const backward = mean(c.map((t) => tokenScore(t, q)));
  return 0.75 * forward + 0.25 * backward;
}

export interface MatchResult<T> {
  status: 'matched' | 'ambiguous' | 'none';
  best?: { item: T; score: number };
  /** Populated for 'ambiguous', and for 'none' as a "did you mean" list. */
  candidates: { item: T; score: number }[];
}

/**
 * Best candidate for a typed name.
 *
 * Returns 'ambiguous' rather than picking a winner when the runner-up is
 * within `ambiguityMargin` -- "Singh" matching both Nirupma Singh and Dhruv
 * Singh equally well is a question for a human, not a coin flip.
 */
export function matchName<T>(
  query: string,
  items: T[],
  nameOf: (item: T) => string,
  opts: { minScore: number; ambiguityMargin: number }
): MatchResult<T> {
  const scored = items
    .map((item) => ({ item, score: scoreName(query, nameOf(item)) }))
    .sort((a, b) => b.score - a.score);

  const best = scored[0];
  if (!best || best.score < opts.minScore) {
    return { status: 'none', candidates: scored.slice(0, 3) };
  }

  const tied = scored.filter(
    (s) => s.score >= opts.minScore && best.score - s.score <= opts.ambiguityMargin
  );
  if (tied.length > 1) {
    return { status: 'ambiguous', best, candidates: tied.slice(0, 5) };
  }

  return { status: 'matched', best, candidates: scored.slice(0, 3) };
}
