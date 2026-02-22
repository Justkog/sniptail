import { logger } from '@sniptail/core/logger.js';
import type { CoreBotEvent, CoreBotEventType } from '@sniptail/core/types/bot-event.js';
import {
  addDiscordReaction,
  editDiscordInteractionReply,
  postDiscordEphemeral,
  postDiscordMessage,
  uploadDiscordFile,
} from './helpers.js';
import type {
  RuntimeBotChannelAdapter,
  BotEventRuntime,
} from '../channels/runtimeBotChannelAdapter.js';

export class DiscordBotChannelAdapter implements RuntimeBotChannelAdapter {
  providerId = 'discord' as const;
  capabilities = {
    threads: true,
    richComponents: true,
    ephemeralMessages: true,
    interactionReplies: true,
    fileUploads: true,
  } as const;
  supportedEventTypes = [
    'message.post',
    'file.upload',
    'reaction.add',
    'message.ephemeral',
    'interaction.reply.edit',
  ] as const satisfies readonly CoreBotEventType[];

  async handleEvent(event: CoreBotEvent, runtime: BotEventRuntime): Promise<boolean> {
    if (event.provider !== this.providerId) {
      return false;
    }
    const client = runtime.discordClient;
    if (!client) {
      logger.warn({ event }, 'Discord bot event received without Discord client');
      return false;
    }
    switch (event.type) {
      case 'message.post':
        await postDiscordMessage(client, {
          channelId: event.payload.channelId,
          text: event.payload.text,
          ...(event.payload.threadId ? { threadId: event.payload.threadId } : {}),
          ...(event.payload.components ? { components: event.payload.components } : {}),
        });
        return true;
      case 'file.upload': {
        const baseOptions = {
          channelId: event.payload.channelId,
          title: event.payload.title,
          ...(event.payload.threadId ? { threadId: event.payload.threadId } : {}),
        };
        const options =
          'filePath' in event.payload
            ? { ...baseOptions, filePath: event.payload.filePath }
            : { ...baseOptions, fileContent: event.payload.fileContent };
        await uploadDiscordFile(client, options);
        return true;
      }
      case 'interaction.reply.edit':
        await editDiscordInteractionReply(client, {
          interactionApplicationId: event.payload.interactionApplicationId,
          interactionToken: event.payload.interactionToken,
          text: event.payload.text,
        });
        return true;
      case 'reaction.add':
        await addDiscordReaction(client, {
          channelId: event.payload.channelId,
          name: event.payload.name,
          timestamp: event.payload.timestamp,
        });
        return true;
      case 'message.ephemeral':
        await postDiscordEphemeral(client, {
          channelId: event.payload.channelId,
          userId: event.payload.userId,
          text: event.payload.text,
          ...(event.payload.threadId ? { threadId: event.payload.threadId } : {}),
        });
        return true;
      default:
        return false;
    }
  }
}
