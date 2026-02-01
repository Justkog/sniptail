import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import type { PartialGroupDMChannel } from 'discord.js';
import {
  type Client,
  type MessageCreateOptions,
  type TextBasedChannel,
  AttachmentBuilder,
  ChannelType,
} from 'discord.js';
import { logger } from '@sniptail/core/logger.js';

type DiscordMessageOptions = {
  channelId: string;
  text: string;
  threadId?: string;
  components?: unknown[];
};

type DiscordFileOptions = {
  channelId: string;
  filePath: string;
  title: string;
  threadId?: string;
};

export type SendableTextChannel = Exclude<TextBasedChannel, PartialGroupDMChannel>;

export function isSendableTextChannel(channel: TextBasedChannel): channel is SendableTextChannel {
  return channel.type !== ChannelType.GroupDM || !channel.partial;
}

async function resolveChannel(client: Client, channelId: string): Promise<SendableTextChannel> {
  const channel = await client.channels.fetch(channelId);
  if (!channel?.isTextBased() || !isSendableTextChannel(channel)) {
    throw new Error(`Channel ${channelId} is not a sendable text channel.`);
  }
  return channel;
}

export async function postDiscordMessage(client: Client, options: DiscordMessageOptions) {
  const targetId = options.threadId ?? options.channelId;
  const channel = await resolveChannel(client, targetId);
  const message: MessageCreateOptions = options.components
    ? {
        content: options.text,
        components: options.components as NonNullable<MessageCreateOptions['components']>,
      }
    : { content: options.text };
  await channel.send(message);
}

export async function uploadDiscordFile(client: Client, options: DiscordFileOptions) {
  try {
    let fileSize: number | undefined;
    try {
      const fileStat = await stat(options.filePath);
      fileSize = fileStat.size;
    } catch (err) {
      logger.warn({ err, filePath: options.filePath }, 'Failed to stat Discord upload file');
    }

    logger.info(
      {
        channelId: options.channelId,
        threadId: options.threadId,
        filePath: options.filePath,
        fileSize,
      },
      'Uploading Discord file',
    );

    const targetId = options.threadId ?? options.channelId;
    const channel = await resolveChannel(client, targetId);
    const attachment = new AttachmentBuilder(createReadStream(options.filePath), {
      name: options.title,
    });
    await channel.send({ files: [attachment] });
  } catch (err) {
    logger.error({ err }, 'Failed to upload Discord file');
    throw err;
  }
}
