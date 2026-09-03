import * as periskope from './periskope';

/**
 * Prove whether Periskope honours `mentions` on /message/send.
 *
 *   npm run check-mentions -- <chat_id> <phone digits...>
 *   npm run check-mentions -- 120363371308389685@g.us 919537851844 919999999999
 *
 * Takes any number of phones, so the two-mention shape of the real daily
 * message can be tested as it will actually be sent.
 *
 * The field is not in Periskope's published OpenAPI schema for that endpoint
 * (chat_id, message, media, reply_to, poll, options), but their stored message
 * record has `mentioned_ids` -- so the way to settle it is to send one and read
 * it back.
 *
 * This sends a real WhatsApp message. Point it at a group you don't mind
 * posting in.
 */
async function main() {
  const [chatId, ...phones] = process.argv.slice(2);
  if (!chatId || phones.length === 0) {
    console.error('usage: npm run check-mentions -- <chat_id> <phone digits...>');
    process.exit(1);
  }

  const all = phones.map((p) => p.replace(/\D/g, '')).filter(Boolean);
  const jids = all.map((d) => periskope.contactJid(d));
  const tokens = all.map((d) => `@${d}`).join(' ');
  const message = `${tokens} mention test, please ignore.`;

  console.log(`chat:    ${chatId}`);
  console.log(`sending: ${message}`);
  console.log(`mentions: ${JSON.stringify(jids)}\n`);

  const sent = await periskope.sendMessage(chatId, message, { mentions: jids });
  console.log('send response:', JSON.stringify(sent, null, 2), '\n');

  const messageId =
    (sent.message_id as string | undefined) ??
    (sent.unique_id as string | undefined) ??
    (sent.queue_id as string | undefined);

  if (!messageId) {
    console.log(
      'No message id came back, so it cannot be read back automatically.\n' +
        'Look at the group: the tags are real mentions if they show the contacts\'\n' +
        `names highlighted, and they were ignored if they show "${tokens}" as plain text.`
    );
    return;
  }

  // The send is queued, so give it a moment to become a stored message.
  await new Promise((r) => setTimeout(r, 4000));

  try {
    const stored = await periskope.getMessage(messageId);
    const mentioned = stored.mentioned_ids ?? null;
    console.log('stored body:        ', stored.body);
    console.log('stored mentioned_ids:', JSON.stringify(mentioned));
    console.log(
      mentioned && mentioned.length > 0
        ? '\nMentions ARE honoured -- the field works and the daily message will tag properly.'
        : `\nMentions were NOT honoured: the message went out with "${tokens}" as plain text.\n` +
            'Try renaming the field to mentioned_ids in periskope.sendMessage, or ask\n' +
            'Periskope which field their send endpoint expects.'
    );
  } catch (err) {
    console.log(
      `Could not read the message back (${err instanceof Error ? err.message : err}).\n` +
        'Check the group by eye instead.'
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
