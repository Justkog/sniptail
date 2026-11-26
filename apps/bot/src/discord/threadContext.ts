import type { Client } from 'discord.js';
import { logger } from '@sniptail/core/logger.js';
import type { JobThreadContextCursor, JobThreadContextSnapshot } from '@sniptail/core/types/job.js';
import { normalizeThreadContextResult as normalizeSlackThreadContextResult } from '../slack/lib/threadContext.js';

const maxThreadHistoryMessages = 20;
const maxThreadHistoryChars = 4000;

export type DiscordThreadContextData = {
  rendered: string;
  snapshot: JobThreadContextSnapshot;
};

export const normalizeThreadContextResult = normalizeSlackThreadContextResult;

export function stripDiscordMentions(text: string): string {
  return text
    .replace(/<@!?\d+>/g, '')
    .replace(/<@&\d+>/g, '')
    .replace(/<#\d+>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function truncateDiscordThreadContext(rendered: string): string {
  if (rendered.length <= maxThreadHistoryChars) return rendered;
  return `...${rendered.slice(-maxThreadHistoryChars)}`;
}

export function renderDiscordThreadContext(messages: JobThreadContextSnapshot['messages']): string {
  return messages.map((message) => `${message.author}: ${message.text}`).join('\n');
}

export function fetchDiscordThreadContext(
  client: Client,
  channelId: string,
  excludeMessageId?: string,
  requireThread?: boolean,
): Promise<string | undefined>;
export function fetchDiscordThreadContext(
  client: Client,
  channelId: string,
  excludeMessageId: string | undefined,
  requireThread: boolean,
  structured: true,
): Promise<DiscordThreadContextData | undefined>;
export async function fetchDiscordThreadContext(
  client: Client,
  channelId: string,
  excludeMessageId?: string,
  requireThread = false,
  structured = false,
): Promise<string | DiscordThreadContextData | undefined> {
  try {
    const channel = await client.channels.fetch(channelId);
    if (!channel || !channel.isTextBased()) return undefined;
    if (requireThread && !channel.isThread()) return undefined;
    const messages = await channel.messages.fetch({ limit: 50 });
    const allHistory = Array.from(messages.values())
      .filter((message) => message.id !== excludeMessageId)
      .reverse();
    const allFiltered = allHistory.filter((message) => message.content);
    const filtered = allFiltered
      // .filter((message) => message.content && !message.author?.bot)
      .slice(-maxThreadHistoryMessages);

    const snapshotMessages = filtered
      .map((message) => {
        const author = message.author?.username ?? message.author?.id ?? 'unknown';
        const text = stripDiscordMentions(message.content ?? '').trim();
        if (!text) return null;
        return {
          externalId: message.id,
          orderKey: message.id,
          author,
          text,
        };
      })
      .filter((message): message is NonNullable<typeof message> => Boolean(message));

    if (!snapshotMessages.length) {
      if (!structured) return undefined;
      if (!excludeMessageId) return undefined;
      return {
        rendered: '',
        snapshot: {
          version: 1,
          provider: 'discord',
          channelId,
          threadId: channelId,
          messages: [],
          rendered: '',
          coversThreadRoot: messages.size < 50 && allHistory.length === 0,
          cursor: {
            provider: 'discord',
            channelId,
            threadId: channelId,
            messageId: excludeMessageId,
            orderKey: excludeMessageId,
          },
        },
      };
    }
    const joined = renderDiscordThreadContext(snapshotMessages);
    const rendered = truncateDiscordThreadContext(joined);
    if (!structured) return rendered;
    const coversThreadRoot =
      messages.size < 50 &&
      allHistory.length <= maxThreadHistoryMessages &&
      snapshotMessages.length === allHistory.length &&
      joined.length <= maxThreadHistoryChars;
    const cursorSource = excludeMessageId ?? snapshotMessages.at(-1)?.externalId;
    const cursor: JobThreadContextCursor | undefined = cursorSource
      ? {
          provider: 'discord',
          channelId,
          threadId: channelId,
          messageId: cursorSource,
          orderKey: cursorSource,
        }
      : undefined;
    const snapshot: JobThreadContextSnapshot = {
      version: 1,
      provider: 'discord',
      channelId,
      threadId: channelId,
      messages: snapshotMessages,
      rendered,
      coversThreadRoot,
      ...(cursor ? { cursor } : {}),
    };
    return { rendered, snapshot };
  } catch (err) {
    logger.warn({ err, channelId }, 'Failed to fetch Discord thread history');
    return undefined;
  }
}
