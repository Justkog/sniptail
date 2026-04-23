import type { Client } from 'discord.js';
import { logger } from '@sniptail/core/logger.js';
import {
  deleteDiscordInteractionReply,
  type DiscordInteractionReplyRef,
} from '../helpers.js';

export async function tryDeleteDiscordSelectorReply(
  client: Client,
  selectorReply: DiscordInteractionReplyRef | undefined,
  options: {
    action: string;
    userId: string;
  },
): Promise<boolean> {
  if (!selectorReply) {
    return false;
  }

  try {
    await deleteDiscordInteractionReply(client, selectorReply);
    return true;
  } catch (err) {
    logger.warn(
      {
        err,
        action: options.action,
        userId: options.userId,
        messageId: selectorReply.messageId,
      },
      'Failed to delete Discord selector reply after opening modal',
    );
    return false;
  }
}
