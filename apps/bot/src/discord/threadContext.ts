import type { Client } from 'discord.js';
import { logger } from '@sniptail/core/logger.js';
import {
  buildThreadContextSnapshot,
  type ThreadContextSnapshotData,
} from '@sniptail/core/channels/threadContextSnapshot.js';
export { normalizeThreadContextResult } from '@sniptail/core/channels/threadContextSnapshot.js';

export type DiscordThreadContextData = ThreadContextSnapshotData;

export function stripDiscordMentions(text: string): string {
  return text
    .replace(/<@!?\d+>/g, '')
    .replace(/<@&\d+>/g, '')
    .replace(/<#\d+>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
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
    const snapshotMessages = allHistory
      .filter((message) => message.content)
      // .filter((message) => message.content && !message.author?.bot)
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

    const data = buildThreadContextSnapshot({
      provider: 'discord',
      channelId,
      threadId: channelId,
      messages: snapshotMessages,
      coversAvailableHistory: messages.size < 50 && snapshotMessages.length === allHistory.length,
      ...(excludeMessageId
        ? {
            cursorMessage: {
              messageId: excludeMessageId,
              orderKey: excludeMessageId,
            },
          }
        : {}),
    });
    if (!data) return undefined;
    return structured ? data : data.threadContext || undefined;
  } catch (err) {
    logger.warn({ err, channelId }, 'Failed to fetch Discord thread history');
    return undefined;
  }
}
