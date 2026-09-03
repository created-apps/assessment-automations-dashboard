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

/** The JID form a WhatsApp contact is addressed by: `919537851844@c.us`. */
export function contactJid(digits: string): string {
  const bare = (digits ?? '').replace(/\D/g, '');
  return bare ? `${bare}@c.us` : '';
}

export interface SendOptions {
  /**
   * Contacts to @-mention, as JIDs (`919537851844@c.us`).
   *
   * WhatsApp renders a mention by matching this list against `@<digits>` in
   * the body, so the message text must contain the bare number for each JID
   * here -- a mention with no matching token in the text shows nothing, and a
   * token with no JID here is just literal text.
   *
   * Undocumented but working. Periskope's published OpenAPI schema for
   * /message/send lists chat_id, message, media, reply_to, poll and options
   * only -- no mentions field -- but the server does honour it: a test send
   * came back with both JIDs on the stored message's mentioned_ids, and the
   * tags rendered as contact names in the group. Re-check with
   * `npm run check-mentions` if a Periskope upgrade ever breaks the tagging.
   */
  mentions?: string[];
}

export function sendMessage(
  chatId: string,
  message: string,
  options: SendOptions = {}
) {
  const mentions = (options.mentions ?? []).filter(Boolean);
  return call<{ queue_id?: string; message_id?: string; unique_id?: string; [key: string]: unknown }>(
    'POST',
    '/message/send',
    {
      chat_id: chatId,
      message,
      ...(mentions.length ? { mentions } : {}),
    }
  );
}

/**
 * One message as Periskope stored it.
 *
 * Only used to check what actually happened to a send -- `mentioned_ids` is
 * how a real mention shows up on the stored record.
 */
export function getMessage(messageId: string) {
  return call<{ mentioned_ids?: string[] | null; body?: string | null; [key: string]: unknown }>(
    'GET',
    `/message/${encodeURIComponent(messageId)}`
  );
}
