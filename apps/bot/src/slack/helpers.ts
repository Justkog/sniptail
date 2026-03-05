import type { App } from '@slack/bolt';
import type { ChatPostMessageResponse, FilesUploadV2Arguments } from '@slack/web-api';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { debugFor, isDebugNamespaceEnabled, logger } from '@sniptail/core/logger.js';

const debugSlack = debugFor('slack');

type SlackErrorShape = {
  code?: string;
  data?: {
    error?: string;
    needed?: string;
    provided?: string;
    response_metadata?: {
      scopes?: string[];
      acceptedScopes?: string[];
      accepted_scopes?: string[];
    };
  };
};

function getSlackErrorDetails(err: unknown): {
  slackErrorCode?: string;
  slackError?: string;
  slackNeededScope?: string;
  slackProvidedScope?: string;
  slackAcceptedScopes?: string[];
  slackTokenScopes?: string[];
} {
  const error = err as SlackErrorShape;
  const acceptedScopes =
    error.data?.response_metadata?.acceptedScopes ?? error.data?.response_metadata?.accepted_scopes;
  return {
    ...(typeof error.code === 'string' ? { slackErrorCode: error.code } : {}),
    ...(typeof error.data?.error === 'string' ? { slackError: error.data.error } : {}),
    ...(typeof error.data?.needed === 'string' ? { slackNeededScope: error.data.needed } : {}),
    ...(typeof error.data?.provided === 'string'
      ? { slackProvidedScope: error.data.provided }
      : {}),
    ...(Array.isArray(acceptedScopes) ? { slackAcceptedScopes: acceptedScopes } : {}),
    ...(Array.isArray(error.data?.response_metadata?.scopes)
      ? { slackTokenScopes: error.data.response_metadata.scopes }
      : {}),
  };
}

function isChannelNotFoundError(err: unknown): boolean {
  return (err as SlackErrorShape).data?.error === 'channel_not_found';
}

async function debugProbeChannelAccess(app: App, channelId: string): Promise<void> {
  try {
    const response = await app.client.conversations.info({ channel: channelId });
    debugSlack(
      {
        api: 'conversations.info',
        channel: channelId,
        ok: response.ok,
        conversationId: response.channel?.id,
        conversationName: response.channel?.name,
        isPrivate: response.channel?.is_private,
        isMember: response.channel?.is_member,
      },
      'Slack debug probe response',
    );
  } catch (probeErr) {
    debugSlack(
      {
        api: 'conversations.info',
        channel: channelId,
        ...getSlackErrorDetails(probeErr),
        err: probeErr,
      },
      'Slack debug probe failed',
    );
  }
}

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

  if (isDebugNamespaceEnabled('slack')) {
    debugSlack(
      {
        api: 'chat.postMessage',
        channel: options.channel,
        threadTs: options.threadTs,
        hasBlocks: Boolean(options.blocks?.length),
        textLength: options.text.length,
      },
      'Slack API request',
    );
  }

  try {
    const response = await app.client.chat.postMessage(payload);
    if (isDebugNamespaceEnabled('slack')) {
      debugSlack(
        {
          api: 'chat.postMessage',
          channel: options.channel,
          threadTs: options.threadTs,
          ok: response.ok,
          ts: response.ts,
        },
        'Slack API response',
      );
    }
    return response;
  } catch (err) {
    if (isDebugNamespaceEnabled('slack')) {
      debugSlack(
        {
          api: 'chat.postMessage',
          channel: options.channel,
          threadTs: options.threadTs,
          ...getSlackErrorDetails(err),
          err,
        },
        'Slack API request failed',
      );
    }
    throw err;
  }
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

  debugSlack(
    {
      api: 'chat.postEphemeral',
      channel: options.channel,
      user: options.user,
      threadTs: options.threadTs,
      hasBlocks: Boolean(options.blocks?.length),
      textLength: options.text.length,
    },
    'Slack API request',
  );

  try {
    const response = await app.client.chat.postEphemeral(payload);
    debugSlack(
      {
        api: 'chat.postEphemeral',
        channel: options.channel,
        user: options.user,
        threadTs: options.threadTs,
        ok: response.ok,
      },
      'Slack API response',
    );
    return response;
  } catch (err) {
    if (isDebugNamespaceEnabled('slack') && isChannelNotFoundError(err)) {
      await debugProbeChannelAccess(app, options.channel);
    }
    debugSlack(
      {
        api: 'chat.postEphemeral',
        channel: options.channel,
        user: options.user,
        threadTs: options.threadTs,
        ...getSlackErrorDetails(err),
        err,
      },
      'Slack API request failed',
    );
    throw err;
  }
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
    } else if (options.fileContent !== undefined) {
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
    debugSlack(
      {
        api: 'files.uploadV2',
        channel: options.channel,
        threadTs: options.threadTs,
        hasFilePath: Boolean(options.filePath),
        fileSize,
      },
      'Slack API request',
    );

    const fileInput = options.filePath
      ? createReadStream(options.filePath)
      : Readable.from([Buffer.from(options.fileContent ?? '', 'utf8')]);

    const payload = {
      channel_id: options.channel,
      file: fileInput,
      filename: options.title,
      title: options.title,
      ...(options.threadTs && { thread_ts: options.threadTs }),
    };

    const response = await app.client.files.uploadV2(payload as FilesUploadV2Arguments);
    debugSlack(
      {
        api: 'files.uploadV2',
        channel: options.channel,
        threadTs: options.threadTs,
        ok: response.ok,
      },
      'Slack API response',
    );
  } catch (err) {
    debugSlack(
      {
        api: 'files.uploadV2',
        channel: options.channel,
        threadTs: options.threadTs,
        ...getSlackErrorDetails(err),
        err,
      },
      'Slack API request failed',
    );
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
  debugSlack(
    {
      api: 'reactions.add',
      channel: options.channel,
      timestamp: options.timestamp,
      name: options.name,
    },
    'Slack API request',
  );
  try {
    const response = await app.client.reactions.add({
      channel: options.channel,
      name: options.name,
      timestamp: options.timestamp,
    });
    debugSlack(
      {
        api: 'reactions.add',
        channel: options.channel,
        timestamp: options.timestamp,
        name: options.name,
        ok: response.ok,
      },
      'Slack API response',
    );
  } catch (err) {
    const error = err as { data?: { error?: string } };
    debugSlack(
      {
        api: 'reactions.add',
        channel: options.channel,
        timestamp: options.timestamp,
        name: options.name,
        ...getSlackErrorDetails(err),
        err,
      },
      'Slack API request failed',
    );
    if (error.data?.error !== 'already_reacted') {
      logger.warn({ err, channel: options.channel }, 'Failed to add Slack reaction');
    }
  }
}
