import { config } from './config';

/**
 * The slice of the Periskope API this service needs: sending a message into a
 * group that the group-creation service already made, and reading back who is
 * in that group -- which is what decides whether a mentor introduction can be
 * sent yet.
 */

export class PeriskopeError extends Error {
  status: number;
  details: unknown;

  constructor(message: string, status: number, details: unknown) {
    super(message);
    this.name = 'PeriskopeError';
    this.status = status;
    this.details = details;
  }
}

async function call<T>(
  method: 'GET' | 'POST',
  pathname: string,
  body?: unknown
): Promise<T> {
  const res = await fetch(`${config.periskope.baseUrl}${pathname}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      authorization: `Bearer ${config.periskope.apiKey}`,
      'x-phone': config.periskope.phone,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  const text = await res.text();
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    data = { raw: text };
  }

  if (!res.ok) {
    throw new PeriskopeError(
      `Periskope ${method} ${pathname} returned ${res.status}: ${text.slice(0, 500)}`,
      res.status,
      data
    );
  }

  return data as T;
}

interface ChatMember {
  contact_id?: string;
  [key: string]: unknown;
}

interface Chat {
  chat_id?: string;
  chat_name?: string;
  members?: Record<string, ChatMember> | ChatMember[];
  [key: string]: unknown;
}

export function getChat(chatId: string): Promise<Chat> {
  return call<Chat>('GET', `/chats/${encodeURIComponent(chatId)}`);
}

/**
 * Who is currently in the group, as bare digits.
 *
 * Periskope returns `members` as an object keyed by contact id
 * (`919537851844@c.us`), but tolerate an array too -- either way what matters
 * is the digits, so the shape of the wrapper shouldn't decide whether a mentor
 * is thought to have joined. Same reader as the group-creation service's.
 */
export async function getChatMemberPhones(chatId: string): Promise<string[]> {
  const chat = await getChat(chatId);
  const members = chat.members;
  if (!members) return [];

  const entries = Array.isArray(members)
    ? members.map((m, i) => [String(i), m] as const)
    : Object.entries(members);

  const phones = new Set<string>();
  for (const [key, member] of entries) {
    const raw = member?.contact_id ?? key;
    const digits = String(raw).split('@')[0]?.replace(/\D/g, '') ?? '';
    if (digits) phones.add(digits);
  }
  return [...phones];
}

export function sendMessage(chatId: string, message: string) {
  return call<{ queue_id?: string; [key: string]: unknown }>(
    'POST',
    '/message/send',
    { chat_id: chatId, message }
  );
}
