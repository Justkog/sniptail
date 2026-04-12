import type { ChannelContext } from '@sniptail/core/types/channel.js';

export function buildTelegramChannelContext(input: {
  chatId: string;
  userId: string;
  replyToMessageId?: string;
}): ChannelContext {
  return {
    provider: 'telegram',
    channelId: input.chatId,
    userId: input.userId,
    ...(input.replyToMessageId ? { threadId: input.replyToMessageId } : {}),
  };
}
