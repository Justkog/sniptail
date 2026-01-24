import type { App } from '@slack/bolt';
import { logger } from '@sniptail/core/logger.js';

const maxThreadHistoryMessages = 20;
const maxThreadHistoryChars = 4000;

export function stripSlackMentions(text: string): string {
  return text
    .replace(/<@[^>]+>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export async function fetchSlackThreadContext(
  client: App['client'],
  channelId: string,
  threadTs: string,
  excludeTs?: string,
): Promise<string | undefined> {
  try {
    const response = await client.conversations.replies({
      channel: channelId,
      ts: threadTs,
      limit: 200,
    });
    const messages =
      (
        response as {
          messages?: Array<{
            ts?: string;
            text?: string;
            user?: string;
            bot_id?: string;
            subtype?: string;
          }>;
        }
      ).messages ?? [];
    const filtered = messages
      .filter((message) => message.ts && message.text)
      .filter((message) => message.ts !== excludeTs)
      .filter((message) => message.subtype !== 'bot_message')
      .slice(-maxThreadHistoryMessages);
    const lines = filtered
      .map((message) => {
        const author = message.user ?? message.bot_id ?? 'unknown';
        const text = stripSlackMentions(message.text ?? '').trim();
        if (!text) return null;
        return `${author}: ${text}`;
      })
      .filter((line): line is string => Boolean(line));
    if (!lines.length) return undefined;
    const joined = lines.join('\n');
    if (joined.length <= maxThreadHistoryChars) {
      return joined;
    }
    return `...${joined.slice(-maxThreadHistoryChars)}`;
  } catch (err) {
    logger.warn({ err, channelId, threadTs }, 'Failed to fetch Slack thread history');
    return undefined;
  }
}
