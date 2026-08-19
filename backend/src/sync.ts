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
  method: 'GET' | 'POST',
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

/**
 * Find a SYNC mentor by exact (normalised) name. Refuses to guess: zero or
 * multiple matches come back as 'none'/'ambiguous' so the caller can warn
 * rather than pick the wrong person.
 */
export async function resolveMentor(name: string): Promise<MentorResolution> {
  const rows = await call<
    { id: string; name: string; phone_number: string | null; email: string | null }[]
  >('GET', `/users?select=id,name,phone_number,email&role=eq.mentor`);
  const target = norm(name);
  const matches = rows.filter((r) => norm(r.name) === target);
  if (matches.length === 0) return { status: 'none' };
  if (matches.length > 1) return { status: 'ambiguous', count: matches.length };
  const m = matches[0]!;
  return {
    status: 'matched',
    mentor: { id: m.id, name: m.name, phone: m.phone_number, email: m.email },
  };
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
