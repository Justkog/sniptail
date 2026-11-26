import type { App } from '@slack/bolt';
import { logger } from '@sniptail/core/logger.js';
import type { JobThreadContextCursor, JobThreadContextSnapshot } from '@sniptail/core/types/job.js';

const maxThreadHistoryMessages = 20;
const maxThreadHistoryChars = 4000;

export type SlackThreadContextData = {
  rendered: string;
  snapshot: JobThreadContextSnapshot;
};

export function normalizeThreadContextResult(result: string | SlackThreadContextData | undefined): {
  threadContext?: string;
  threadContextSnapshot?: JobThreadContextSnapshot;
} {
  if (!result) return {};
  if (typeof result === 'string') return { threadContext: result };
  return {
    threadContext: result.rendered,
    threadContextSnapshot: result.snapshot,
  };
}

export function stripSlackMentions(text: string): string {
  return text
    .replace(/<@[^>]+>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function truncateSlackThreadContext(rendered: string): string {
  if (rendered.length <= maxThreadHistoryChars) return rendered;
  return `...${rendered.slice(-maxThreadHistoryChars)}`;
}

export function renderSlackThreadContext(messages: JobThreadContextSnapshot['messages']): string {
  return messages.map((message) => `${message.author}: ${message.text}`).join('\n');
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
    const allFiltered = allHistory.filter((message) => message.text);
    const filtered = allFiltered
      // .filter((message) => message.subtype !== 'bot_message')
      .slice(-maxThreadHistoryMessages);
    const snapshotMessages = filtered
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
    if (!snapshotMessages.length) {
      if (!structured) return undefined;
      const cursorMessage = messages.find((message) => message.ts === excludeTs && message.ts);
      if (!cursorMessage?.ts) return undefined;
      return {
        rendered: '',
        snapshot: {
          version: 1,
          provider: 'slack',
          channelId,
          threadId: threadTs,
          messages: [],
          rendered: '',
          coversThreadRoot:
            !response.has_more &&
            !response.response_metadata?.next_cursor &&
            allHistory.length === 0,
          cursor: {
            provider: 'slack',
            channelId,
            threadId: threadTs,
            messageId: cursorMessage.ts,
            orderKey: cursorMessage.ts,
          },
        },
      };
    }
    const joined = renderSlackThreadContext(snapshotMessages);
    const rendered = truncateSlackThreadContext(joined);
    if (!structured) return rendered;
    const coversThreadRoot =
      !response.has_more &&
      !response.response_metadata?.next_cursor &&
      allHistory.length <= maxThreadHistoryMessages &&
      snapshotMessages.length === allHistory.length &&
      joined.length <= maxThreadHistoryChars;
    const cursorMessage = messages.find((message) => message.ts === excludeTs && message.ts);
    const cursorSource = cursorMessage?.ts ?? snapshotMessages.at(-1);
    const cursor: JobThreadContextCursor | undefined =
      typeof cursorSource === 'string'
        ? {
            provider: 'slack',
            channelId,
            threadId: threadTs,
            messageId: cursorSource,
            orderKey: cursorSource,
          }
        : cursorSource
          ? {
              provider: 'slack',
              channelId,
              threadId: threadTs,
              messageId: cursorSource.externalId,
              orderKey: cursorSource.orderKey,
            }
          : undefined;
    const snapshot: JobThreadContextSnapshot = {
      version: 1,
      provider: 'slack',
      channelId,
      threadId: threadTs,
      messages: snapshotMessages,
      rendered,
      coversThreadRoot,
      ...(cursor ? { cursor } : {}),
    };
    return { rendered, snapshot };
  } catch (err) {
    logger.warn({ err, channelId, threadTs }, 'Failed to fetch Slack thread history');
    return undefined;
  }
}
