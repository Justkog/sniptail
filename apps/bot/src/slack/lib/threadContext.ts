import type { App } from '@slack/bolt';
import { logger } from '@sniptail/core/logger.js';
import {
  buildThreadContextSnapshot,
  type ThreadContextSnapshotData,
} from '@sniptail/core/channels/threadContextSnapshot.js';
export { normalizeThreadContextResult } from '@sniptail/core/channels/threadContextSnapshot.js';

export type SlackThreadContextData = ThreadContextSnapshotData;

export function stripSlackMentions(text: string): string {
  return text
    .replace(/<@[^>]+>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function fetchSlackThreadContext(
  client: App['client'],
  channelId: string,
  threadTs: string,
  excludeTs?: string,
): Promise<string | undefined>;
export function fetchSlackThreadContext(
  client: App['client'],
  channelId: string,
  threadTs: string,
  excludeTs: string | undefined,
  structured: true,
): Promise<SlackThreadContextData | undefined>;
export async function fetchSlackThreadContext(
  client: App['client'],
  channelId: string,
  threadTs: string,
  excludeTs?: string,
  structured = false,
): Promise<string | SlackThreadContextData | undefined> {
  try {
    const response = await client.conversations.replies({
      channel: channelId,
      ts: threadTs,
      limit: 200,
    });
    const messages =
      (
        response as {
          has_more?: boolean;
          response_metadata?: {
            next_cursor?: string;
          };
          messages?: Array<{
            ts?: string;
            text?: string;
            user?: string;
            bot_id?: string;
            subtype?: string;
          }>;
        }
      ).messages ?? [];
    const allHistory = messages.filter((message) => message.ts && message.ts !== excludeTs);
    const snapshotMessages = allHistory
      .filter((message) => message.text)
      // .filter((message) => message.subtype !== 'bot_message')
      .map((message) => {
        const author = message.user ?? message.bot_id ?? 'unknown';
        const text = stripSlackMentions(message.text ?? '').trim();
        if (!text) return null;
        return {
          externalId: message.ts!,
          orderKey: message.ts!,
          author,
          text,
        };
      })
      .filter((message): message is NonNullable<typeof message> => Boolean(message));
    const triggerMessage = messages.find((message) => message.ts === excludeTs);
    const data = buildThreadContextSnapshot({
      provider: 'slack',
      channelId,
      threadId: threadTs,
      messages: snapshotMessages,
      coversAvailableHistory:
        !response.has_more &&
        !response.response_metadata?.next_cursor &&
        snapshotMessages.length === allHistory.length,
      ...(triggerMessage?.ts
        ? {
            cursorMessage: {
              messageId: triggerMessage.ts,
              orderKey: triggerMessage.ts,
            },
          }
        : {}),
    });
    if (!data) return undefined;
    return structured ? data : data.threadContext || undefined;
  } catch (err) {
    logger.warn({ err, channelId, threadTs }, 'Failed to fetch Slack thread history');
    return undefined;
  }
}
