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
        await this.postMessageEvent(client, event);
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

  private async postMessageEvent(
    client: Parameters<typeof postDiscordMessage>[0],
    event: CoreBotEvent<'message.post'>,
  ) {
    const messageOptions = {
      channelId: event.payload.channelId,
      text: event.payload.text,
      ...(event.payload.threadId ? { threadId: event.payload.threadId } : {}),
      ...(event.payload.components ? { components: event.payload.components } : {}),
    };

    if (event.payload.text.length <= DISCORD_MESSAGE_CONTENT_LIMIT) {
      await postDiscordMessage(client, messageOptions);
      return;
    }

    const title = buildOverflowFileTitle(event.jobId);
    logger.info(
      {
        jobId: event.jobId,
        channelId: event.payload.channelId,
        threadId: event.payload.threadId,
        textLength: event.payload.text.length,
        title,
      },
      'Discord message.post exceeded content limit; uploading overflow attachment',
    );

    try {
      await uploadDiscordFile(client, {
        channelId: event.payload.channelId,
        fileContent: event.payload.text,
        title,
        ...(event.payload.threadId ? { threadId: event.payload.threadId } : {}),
      });
    } catch (err) {
      logger.error(
        {
          err,
          jobId: event.jobId,
          channelId: event.payload.channelId,
          threadId: event.payload.threadId,
        },
        'Failed to upload Discord overflow attachment for message.post',
      );
      await postDiscordMessage(client, {
        ...messageOptions,
        text: buildOverflowUploadFailedText(event.jobId),
      });
      return;
    }

    await postDiscordMessage(client, {
      ...messageOptions,
      text: buildOverflowStubText(event.jobId, title),
    });
  }
}

const DISCORD_MESSAGE_CONTENT_LIMIT = 2000;

function buildOverflowStubText(jobId?: string, title?: string): string {
  const lines = ['Response was too long for Discord; full content is attached.'];
  if (jobId) {
    lines.push(`Job: ${jobId}`);
  }
  if (title) {
    lines.push(`Attachment: ${title}`);
  }
  return lines.join('\n');
}

function buildOverflowUploadFailedText(jobId?: string): string {
  const lines = ['Response was too long for Discord, and uploading the attachment failed.'];
  if (jobId) {
    lines.push(`Job: ${jobId}`);
  }
  return lines.join('\n');
}

function buildOverflowFileTitle(jobId?: string): string {
  if (!jobId?.trim()) {
    return 'sniptail-discord-message.md';
  }
  const sanitizedJobId = sanitizeFileNameSegment(jobId);
  if (!sanitizedJobId) {
    return 'sniptail-discord-message.md';
  }
  return `sniptail-${sanitizedJobId}-message.md`;
}

function sanitizeFileNameSegment(value: string): string {
  return value
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}
