import type { Client } from 'discord.js';
import { logger } from '@sniptail/core/logger.js';

const maxThreadHistoryMessages = 20;
const maxThreadHistoryChars = 4000;

export function stripDiscordMentions(text: string): string {
  return text
    .replace(/<@!?\d+>/g, '')
    .replace(/<@&\d+>/g, '')
    .replace(/<#\d+>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export async function fetchDiscordThreadContext(
  client: Client,
  channelId: string,
  excludeMessageId?: string,
): Promise<string | undefined> {
  try {
    const channel = await client.channels.fetch(channelId);
    if (!channel || !channel.isTextBased()) return undefined;
    const messages = await channel.messages.fetch({ limit: 50 });
    const filtered = Array.from(messages.values())
      .filter((message) => message.id !== excludeMessageId)
      // .filter((message) => message.content && !message.author?.bot)
      .slice(0, maxThreadHistoryMessages)
      .reverse();

    const lines = filtered
      .map((message) => {
        const author = message.author?.username ?? message.author?.id ?? 'unknown';
        const text = stripDiscordMentions(message.content ?? '').trim();
        if (!text) return null;
        return `${author}: ${text}`;
      })
      .filter((line): line is string => Boolean(line));

    if (!lines.length) return undefined;
    const joined = lines.join('\n');
    if (joined.length <= maxThreadHistoryChars) return joined;
    return `...${joined.slice(-maxThreadHistoryChars)}`;
  } catch (err) {
    logger.warn({ err, channelId }, 'Failed to fetch Discord thread history');
    return undefined;
  }
}
