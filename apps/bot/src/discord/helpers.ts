import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import type { PartialGroupDMChannel } from 'discord.js';
import {
  type Client,
  type MessageCreateOptions,
  type TextBasedChannel,
  AttachmentBuilder,
  ChannelType,
  Routes,
} from 'discord.js';
import { logger } from '@sniptail/core/logger.js';

type DiscordMessageOptions = {
  channelId: string;
  text: string;
  threadId?: string;
  components?: unknown[];
};

type DiscordFileOptions =
  | { channelId: string; filePath: string; fileContent?: never; title: string; threadId?: string }
  | { channelId: string; filePath?: never; fileContent: string; title: string; threadId?: string };

type DiscordInteractionReplyOptions = {
  interactionToken: string;
  interactionApplicationId: string;
  text: string;
};

type DiscordReactionOptions = {
  channelId: string;
  name: string;
  timestamp: string;
};

type DiscordEphemeralOptions = {
  channelId: string;
  userId: string;
  text: string;
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
    if (options.filePath === undefined && options.fileContent === undefined) {
      throw new Error('Discord upload requires filePath or fileContent.');
    }

    let fileSize: number | undefined;
    if (options.filePath) {
      try {
        const fileStat = await stat(options.filePath);
        fileSize = fileStat.size;
      } catch (err) {
        logger.warn({ err, filePath: options.filePath }, 'Failed to stat Discord upload file');
      }
    } else if (options.fileContent !== undefined) {
      fileSize = Buffer.byteLength(options.fileContent, 'utf8');
    }

    logger.info(
      {
        channelId: options.channelId,
        threadId: options.threadId,
        ...(options.filePath ? { filePath: options.filePath } : {}),
        uploadSource: options.fileContent !== undefined ? 'inline-content' : 'local-file',
        fileSize,
      },
      'Uploading Discord file',
    );

    const targetId = options.threadId ?? options.channelId;
    const channel = await resolveChannel(client, targetId);
    const attachment = new AttachmentBuilder(
      options.filePath
        ? createReadStream(options.filePath)
        : Buffer.from(options.fileContent ?? '', 'utf8'),
      {
        name: options.title,
      },
    );
    await channel.send({ files: [attachment] });
  } catch (err) {
    logger.error({ err }, 'Failed to upload Discord file');
    throw err;
  }
}

export async function editDiscordInteractionReply(
  client: Client,
  options: DiscordInteractionReplyOptions,
) {
  await client.rest.patch(
    Routes.webhookMessage(options.interactionApplicationId, options.interactionToken, '@original'),
    { body: { content: options.text } },
  );
}

function normalizeReactionName(name: string): string {
  return name.replace(/^:|:$/g, '');
}

export async function addDiscordReaction(client: Client, options: DiscordReactionOptions) {
  try {
    const channel = await resolveChannel(client, options.channelId);
    const message = await channel.messages.fetch(options.timestamp);
    await message.react(normalizeReactionName(options.name));
  } catch (err) {
    logger.warn(
      {
        err,
        channelId: options.channelId,
        timestamp: options.timestamp,
        name: options.name,
      },
      'Failed to add Discord reaction',
    );
  }
}

export async function postDiscordEphemeral(client: Client, options: DiscordEphemeralOptions) {
  try {
    const user = await client.users.fetch(options.userId);
    await user.send({ content: options.text });
    return;
  } catch (err) {
    logger.warn(
      {
        err,
        channelId: options.channelId,
        userId: options.userId,
      },
      'Failed to send Discord DM fallback for ephemeral message',
    );
  }

  const mentionText = `<@${options.userId}> ${options.text}`;
  await postDiscordMessage(client, {
    channelId: options.channelId,
    text: mentionText,
    ...(options.threadId ? { threadId: options.threadId } : {}),
  });
}
