import { config } from './config';

/**
 * A thin reader/writer for SYNC's Supabase project, used at mentor-introduction
 * time: look up the mentor (for their phone/email) and link them into the
 * student's group via user_group_memberships.
 *
 * SYNC's model: a WhatsApp group is a `groups` row keyed by `group_jid`
 * (== our chat_id); membership is `user_group_memberships (user_id, group_id,
 * role)`. A mentor is a pre-existing `users` row with role 'mentor'.
 */

export function syncConfigured(): boolean {
  return config.sync.configured;
}

async function call<T>(
  method: 'GET' | 'POST' | 'PATCH',
  pathname: string,
  init: { body?: unknown; prefer?: string } = {}
): Promise<T> {
  const res = await fetch(`${config.sync.url}/rest/v1${pathname}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      apikey: config.sync.serviceKey,
      authorization: `Bearer ${config.sync.serviceKey}`,
      ...(init.prefer ? { Prefer: init.prefer } : {}),
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  const text = await res.text();
  let data: unknown;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { raw: text };
  }
  if (!res.ok) {
    throw new Error(`SYNC ${method} ${pathname.split('?')[0]} returned ${res.status}: ${text.slice(0, 300)}`);
  }
  return data as T;
}

/** Collapse whitespace (SYNC has names with trailing tabs) and fold case. */
const norm = (s: string): string => s.normalize('NFKC').replace(/\s+/g, ' ').trim().toLowerCase();

export interface ResolvedMentor {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
}

export type MentorResolution =
  | { status: 'matched'; mentor: ResolvedMentor }
  | { status: 'none' }
  | { status: 'ambiguous'; count: number };

/** Fold an email for comparison -- SYNC stores whatever was typed. */
const normEmail = (s: string): string => (s ?? '').trim().toLowerCase();

const MENTOR_COLUMNS = 'id,name,phone_number,email';

interface MentorRow {
  id: string;
  name: string;
  phone_number: string | null;
  email: string | null;
}

const toResolved = (r: MentorRow): ResolvedMentor => ({
  id: r.id,
  name: r.name,
  phone: r.phone_number,
  email: r.email,
});

/**
 * Every SYNC mentor, in one request.
 *
 * Read once per pass by callers that check many cases in a row (the sheet
 * intake), so a hundred rows naming a mentor still costs a single call.
 */
export async function listMentors(): Promise<ResolvedMentor[]> {
  const rows = await call<MentorRow[]>(
    'GET',
    `/users?select=${MENTOR_COLUMNS}&role=eq.mentor`
  );
  return rows.map(toResolved);
}

/**
 * Pick the mentor a name and/or an email is pointing at, out of a directory
 * already read with listMentors.
 *
 * Email first: it is the one field ops copy rather than retype, and two
 * mentors sharing a spelling of their name is likelier than two sharing an
 * address. Name is the fallback, and exact (after normalisation) -- zero or
 * several matches come back as 'none'/'ambiguous' so the caller can warn
 * rather than link the wrong person.
 */
export function matchMentor(
  mentors: ResolvedMentor[],
  input: { name?: string; email?: string }
): MentorResolution {
  const email = normEmail(input.email ?? '');
  if (email) {
    const byEmail = mentors.filter((m) => m.email && normEmail(m.email) === email);
    if (byEmail.length === 1) return { status: 'matched', mentor: byEmail[0]! };
    if (byEmail.length > 1) return { status: 'ambiguous', count: byEmail.length };
  }

  const name = norm(input.name ?? '');
  if (!name) return { status: 'none' };
  const byName = mentors.filter((m) => norm(m.name) === name);
  if (byName.length === 0) return { status: 'none' };
  if (byName.length > 1) return { status: 'ambiguous', count: byName.length };
  return { status: 'matched', mentor: byName[0]! };
}

/**
 * Find a SYNC mentor by exact (normalised) name. Refuses to guess: zero or
 * multiple matches come back as 'none'/'ambiguous' so the caller can warn
 * rather than pick the wrong person.
 */
export async function resolveMentor(name: string): Promise<MentorResolution> {
  return matchMentor(await listMentors(), { name });
}

/** The SYNC group id for a WhatsApp JID, or null if SYNC hasn't onboarded it. */
export async function findGroupIdByJid(jid: string): Promise<string | null> {
  const rows = await call<{ id: string }[]>(
    'GET',
    `/groups?select=id&group_jid=eq.${encodeURIComponent(jid)}&limit=1`
  );
  return rows[0]?.id ?? null;
}

/**
 * Ensure a (mentor, group, 'mentor') membership exists. Idempotent: returns
 * 'exists' when it was already there, 'inserted' when it was created.
 */
export async function ensureMentorMembership(
  mentorUserId: string,
  groupId: string
): Promise<'inserted' | 'exists'> {
  const existing = await call<{ id: string }[]>(
    'GET',
    `/user_group_memberships?select=id&user_id=eq.${mentorUserId}&group_id=eq.${groupId}&limit=1`
  );
  if (existing[0]) return 'exists';

  await call('POST', '/user_group_memberships', {
    body: { user_id: mentorUserId, group_id: groupId, role: 'mentor' },
    prefer: 'return=minimal',
  });
  return 'inserted';
}

// ---------------------------------------------------------------------------
// Mentor accounts.
//
// A mentor added in the dashboard needs a SYNC `users` row before anything can
// be linked to them. SYNC's users are keyed on phone_number (the group-creation
// service inserts students and parents with on_conflict=phone_number), and it
// is NOT NULL -- which is why the dashboard now requires a mentor's phone.
//
// Numbers predate a settled format, so a lookup tries both shapes even though
// rows written here use one. Same rule as the group-creation service.

/** The two shapes a number might already be stored in. */
function phoneVariants(digits: string): string[] {
  return [digits, `+${digits}`];
}

/** Strip a number to digits, the form both shapes are built from. */
export function phoneDigits(raw: string): string {
  return (raw ?? '').replace(/\D/g, '');
}

function formatPhone(digits: string): string {
  return config.sync.phoneFormat === 'plus' ? `+${digits}` : digits;
}

export interface SyncUser {
  id: string;
  name: string;
  phone_number: string;
  email: string | null;
  role: string;
}

const USER_COLUMNS = 'id,name,phone_number,email,role';

/** The SYNC user holding this number, whichever shape it is stored in. */
export async function findUserByPhone(digits: string): Promise<SyncUser | null> {
  if (!digits) return null;
  const params = new URLSearchParams({
    select: USER_COLUMNS,
    or: `(${phoneVariants(digits).map((v) => `phone_number.eq.${v}`).join(',')})`,
    limit: '1',
  });
  const rows = await call<SyncUser[]>('GET', `/users?${params}`);
  return rows[0] ?? null;
}

/** One SYNC user by id, or null if they have since been removed. */
export async function findUserById(id: string): Promise<SyncUser | null> {
  const rows = await call<SyncUser[]>(
    'GET',
    `/users?select=${USER_COLUMNS}&id=eq.${encodeURIComponent(id)}&limit=1`
  );
  return rows[0] ?? null;
}

export interface EnsureMentorInput {
  name: string;
  /** Required: SYNC's users.phone_number is NOT NULL and is the natural key. */
  phone: string;
  email?: string | null;
}

export type EnsureMentorResult =
  | { outcome: 'created'; user: SyncUser }
  | { outcome: 'existing'; user: SyncUser }
  /** The number was on file under another role, and has been made a mentor. */
  | { outcome: 'promoted'; user: SyncUser; previousRole: string };

/**
 * Make sure the mentor exists on SYNC as a `users` row with role 'mentor', and
 * return it. Idempotent on the phone number, so adding the same mentor twice
 * adopts the existing account rather than creating a second one.
 *
 * A number already on file under a different role is promoted to mentor (the
 * team's call: the same person is often already in SYNC as a staff contact).
 * Their name and email are left alone -- SYNC's copy is the one its own
 * onboarding maintains.
 */
export async function ensureMentorUser(
  input: EnsureMentorInput
): Promise<EnsureMentorResult> {
  const digits = phoneDigits(input.phone);
  if (!digits) {
    throw new Error(`"${input.phone}" has no digits -- SYNC needs a phone number`);
  }

  const existing = await findUserByPhone(digits);
  if (existing) {
    if (existing.role === 'mentor') return { outcome: 'existing', user: existing };

    const previousRole = existing.role;
    const updated = await call<SyncUser[]>(
      'PATCH',
      `/users?id=eq.${encodeURIComponent(existing.id)}`,
      { body: { role: 'mentor' }, prefer: 'return=representation' }
    );
    return {
      outcome: 'promoted',
      user: updated[0] ?? { ...existing, role: 'mentor' },
      previousRole,
    };
  }

  const created = await call<SyncUser[]>('POST', '/users', {
    body: {
      name: input.name,
      phone_number: formatPhone(digits),
      email: input.email || null,
      role: 'mentor',
      // Mentors belong to many groups, so membership is the only link they
      // carry -- users.group_id stays null rather than naming one of them.
      group_id: null,
    },
    prefer: 'return=representation',
  });
  const user = created[0];
  if (!user) throw new Error('SYNC users insert returned no row');
  return { outcome: 'created', user };
}
