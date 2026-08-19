import { config } from './config';

/**
 * The slice of the Periskope API this service needs: sending a message into a
 * group that the group-creation service already made.
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

export function sendMessage(chatId: string, message: string) {
  return call<{ queue_id?: string; [key: string]: unknown }>(
    'POST',
    '/message/send',
    { chat_id: chatId, message }
  );
}
