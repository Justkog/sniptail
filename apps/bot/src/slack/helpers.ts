import type { App } from '@slack/bolt';
import type { ChatPostMessageResponse, FilesUploadV2Arguments } from '@slack/web-api';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { logger } from '@sniptail/core/logger.js';

export async function postMessage(
  app: App,
  options: {
    channel: string;
    text: string;
    threadTs?: string;
    blocks?: unknown[];
  },
): Promise<ChatPostMessageResponse> {
  const payload = {
    channel: options.channel,
    text: options.text,
    ...(options.threadTs && { thread_ts: options.threadTs }),
    ...(options.blocks && { blocks: options.blocks }),
  };

  return app.client.chat.postMessage(payload);
}

export async function postEphemeral(
  app: App,
  options: {
    channel: string;
    user: string;
    text: string;
    threadTs?: string;
    blocks?: unknown[];
  },
) {
  const payload = {
    channel: options.channel,
    user: options.user,
    text: options.text,
    ...(options.threadTs && { thread_ts: options.threadTs }),
    ...(options.blocks && { blocks: options.blocks }),
  };

  return app.client.chat.postEphemeral(payload);
}

export async function uploadFile(
  app: App,
  options:
    | { channel: string; filePath: string; fileContent?: never; title: string; threadTs?: string }
    | { channel: string; filePath?: never; fileContent: string; title: string; threadTs?: string },
) {
  try {
    if (!options.filePath && !options.fileContent) {
      throw new Error('Slack upload requires filePath or fileContent.');
    }

    let fileSize: number | undefined;
    if (options.filePath) {
      try {
        const fileStat = await stat(options.filePath);
        fileSize = fileStat.size;
      } catch (err) {
        logger.warn({ err, filePath: options.filePath }, 'Failed to stat Slack upload file');
      }
    } else if (options.fileContent) {
      fileSize = Buffer.byteLength(options.fileContent, 'utf8');
    }

    logger.info(
      {
        channel: options.channel,
        threadTs: options.threadTs,
        threadTsType: typeof options.threadTs,
        ...(options.filePath ? { filePath: options.filePath } : {}),
        uploadSource: options.fileContent ? 'inline-content' : 'local-file',
        fileSize,
      },
      'Uploading Slack file',
    );

    const fileInput = options.filePath
      ? createReadStream(options.filePath)
      : Readable.from(options.fileContent ?? '');

    const payload = {
      channel_id: options.channel,
      file: fileInput,
      filename: options.title,
      title: options.title,
      ...(options.threadTs && { thread_ts: options.threadTs }),
    };

    await app.client.files.uploadV2(payload as FilesUploadV2Arguments);
  } catch (err) {
    logger.error({ err }, 'Failed to upload Slack file');
    throw err;
  }
}

export async function addReaction(
  app: App,
  options: {
    channel: string;
    name: string;
    timestamp: string;
  },
) {
  try {
    await app.client.reactions.add({
      channel: options.channel,
      name: options.name,
      timestamp: options.timestamp,
    });
  } catch (err) {
    const error = err as { data?: { error?: string } };
    if (error.data?.error !== 'already_reacted') {
      logger.warn({ err, channel: options.channel }, 'Failed to add Slack reaction');
    }
  }
}
