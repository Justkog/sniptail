import type { ChatInputCommandInteraction, Message, ModalSubmitInteraction } from 'discord.js';
import type { ChannelContext } from '@sniptail/core/types/channel.js';

export function isChannelAllowed(
  channelIds: string[] | undefined,
  channelId: string,
  parentChannelId?: string,
): boolean {
  if (!channelIds || channelIds.length === 0) return true;
  if (channelIds.includes(channelId)) return true;
  if (parentChannelId && channelIds.includes(parentChannelId)) return true;
  return false;
}

export function buildChannelContext(message: Message): ChannelContext {
  return {
    provider: 'discord',
    channelId: message.channelId,
    ...(message.channel.isThread() ? { threadId: message.channelId } : {}),
    userId: message.author.id,
    ...(message.guildId ? { guildId: message.guildId } : {}),
  };
}

export function buildInteractionChannelContext(
  interaction: ChatInputCommandInteraction | ModalSubmitInteraction,
): ChannelContext {
  const channelId = interaction.channelId ?? interaction.user.id;
  const threadId = interaction.channel?.isThread() ? channelId : undefined;
  return {
    provider: 'discord',
    channelId,
    ...(threadId ? { threadId } : {}),
    userId: interaction.user.id,
    ...(interaction.guildId ? { guildId: interaction.guildId } : {}),
  };
}
