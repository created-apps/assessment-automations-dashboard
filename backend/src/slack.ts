import { config } from './config';

/**
 * Slack is an outbound notification channel and nothing more.
 *
 * Instructions used to arrive as thread replies; they now come from the
 * dashboard over HTTP, so there is no inbound path here -- no event endpoint,
 * no signature verification, no reply polling. All that remains is posting.
 */

export class SlackError extends Error {
  details: unknown;

  constructor(message: string, details: unknown) {
    super(message);
    this.name = 'SlackError';
    this.details = details;
  }
}

interface SlackResponse {
  ok: boolean;
  error?: string;
  ts?: string;
  channel?: string;
  [key: string]: unknown;
}

async function call(method: string, body: unknown): Promise<SlackResponse> {
  const res = await fetch(`${config.slack.baseUrl}/${method}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      authorization: `Bearer ${config.slack.botToken}`,
    },
    body: JSON.stringify(body),
  });

  const text = await res.text();
  let data: SlackResponse;
  try {
    data = JSON.parse(text) as SlackResponse;
  } catch {
    throw new SlackError(
      `Slack ${method} returned unparseable body: ${text.slice(0, 300)}`,
      { raw: text }
    );
  }

  // Slack answers 200 with ok:false for application errors, so the HTTP status
  // on its own says almost nothing.
  if (!res.ok || !data.ok) {
    throw new SlackError(
      `Slack ${method} failed: ${data.error ?? res.status}`,
      data
    );
  }

  return data;
}

export interface PostedMessage {
  channel: string;
  ts: string;
}

export async function postMessage(input: {
  text: string;
  /** Omit to start a new thread; pass a parent ts to reply inside one. */
  threadTs?: string;
  channel?: string;
}): Promise<PostedMessage> {
  const data = await call('chat.postMessage', {
    channel: input.channel ?? config.slack.channel,
    text: input.text,
    ...(input.threadTs ? { thread_ts: input.threadTs } : {}),
    // Keep link previews out of the channel: these messages carry Google Form
    // and Calendly URLs and unfurling them makes the thread unreadable.
    unfurl_links: false,
    unfurl_media: false,
  });

  const ts = data.ts;
  const channel = data.channel ?? input.channel ?? config.slack.channel;
  if (!ts) {
    throw new SlackError('chat.postMessage returned no ts', data);
  }
  return { channel: String(channel), ts: String(ts) };
}
