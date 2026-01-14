import type { App } from '@slack/bolt';
import { createReadStream } from 'node:fs';
import { logger } from '../logger.js';

export async function postMessage(app: App, options: {
  channel: string;
  text: string;
  threadTs?: string;
  blocks?: unknown[];
}) {
  const payload: Record<string, unknown> = {
    channel: options.channel,
    text: options.text,
  };

  if (options.threadTs) {
    payload.thread_ts = options.threadTs;
  }
  if (options.blocks) {
    payload.blocks = options.blocks;
  }

  return app.client.chat.postMessage(payload as any);
}

export async function uploadFile(app: App, options: {
  channel: string;
  filePath: string;
  title: string;
  threadTs?: string;
}) {
  try {
    const payload: Record<string, unknown> = {
      channel_id: options.channel,
      file: createReadStream(options.filePath),
      filename: options.title,
      title: options.title,
    };

    if (options.threadTs) {
      payload.thread_ts = options.threadTs;
    }

    await app.client.files.uploadV2(payload as any);
  } catch (err) {
    logger.error({ err }, 'Failed to upload Slack file');
    throw err;
  }
}

export async function addReaction(app: App, options: {
  channel: string;
  name: string;
  timestamp: string;
}) {
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
