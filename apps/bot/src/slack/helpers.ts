import type { App } from '@slack/bolt';
import type { ChatPostMessageResponse, FilesUploadV2Arguments } from '@slack/web-api';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { debugFor, isDebugNamespaceEnabled, logger } from '@sniptail/core/logger.js';
import type { JobContextFile } from '@sniptail/core/types/job.js';
import {
  CONTEXT_FILE_EXTENSIONS,
  isAllowedContextFile,
  MAX_CONTEXT_FILES,
  MAX_CONTEXT_FILE_BYTES,
  MAX_CONTEXT_TOTAL_BYTES,
} from '../lib/contextFilePolicy.js';

const debugSlack = debugFor('slack');

export const SLACK_CONTEXT_FILE_INPUT_BLOCK_ID = 'context_files';
export const SLACK_CONTEXT_FILE_INPUT_ACTION_ID = 'context_files';
export const SLACK_CONTEXT_FILE_INPUT_FILETYPES = CONTEXT_FILE_EXTENSIONS;

type SlackFileInfo = {
  id: string;
  name?: string;
  mimetype?: string;
  filetype?: string;
  size?: number;
  permalink?: string;
  url_private?: string;
  url_private_download?: string;
};

type SlackUploadedFile = {
  id?: string;
};

type SlackReplyMessage = {
  ts?: string;
  files?: SlackUploadedFile[];
};

type SlackViewStateValue = {
  files?: SlackUploadedFile[];
};

type SlackViewStateValues = Record<
  string,
  Record<string, SlackViewStateValue | undefined> | undefined
>;

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

function isAllowedSlackContextFile(file: SlackFileInfo): boolean {
  return isAllowedContextFile({ fileName: file.name, mediaType: file.mimetype });
}

function getUniqueSlackContextFileIds(files?: SlackUploadedFile[]): string[] {
  const fileIds = files
    ?.map((file) => file.id?.trim())
    .filter((fileId): fileId is string => Boolean(fileId));
  if (!fileIds?.length) {
    return [];
  }
  return Array.from(new Set(fileIds));
}

function getSubmittedSlackContextFileIds(state: SlackViewStateValues): string[] {
  const actionState =
    state[SLACK_CONTEXT_FILE_INPUT_BLOCK_ID]?.[SLACK_CONTEXT_FILE_INPUT_ACTION_ID];
  return getUniqueSlackContextFileIds(actionState?.files);
}

async function fetchSlackFileInfo(client: App['client'], fileId: string): Promise<SlackFileInfo> {
  const response = await client.files.info({ file: fileId });
  const file = (response as { file?: SlackFileInfo }).file;
  if (!file?.id) {
    throw new Error(`Slack did not return metadata for uploaded file ${fileId}.`);
  }
  return file;
}

async function downloadSlackFile(botToken: string, file: SlackFileInfo): Promise<Buffer> {
  const downloadUrl = file.url_private_download ?? file.url_private;
  if (!downloadUrl) {
    throw new Error(`Slack file ${file.id} does not expose a download URL.`);
  }

  const response = await fetch(downloadUrl, {
    headers: {
      Authorization: `Bearer ${botToken}`,
    },
  });
  if (!response.ok) {
    throw new Error(`Slack file download failed (${response.status}).`);
  }

  const content = Buffer.from(await response.arrayBuffer());
  if (!content.byteLength) {
    throw new Error(`Slack file ${file.id} is empty.`);
  }
  return content;
}

async function loadSlackContextFilesByIds(input: {
  client: App['client'];
  botToken?: string | undefined;
  fileIds: string[];
}): Promise<JobContextFile[]> {
  if (!input.fileIds.length) {
    return [];
  }
  if (!input.botToken) {
    throw new Error('Slack bot token is required to download uploaded files.');
  }
  if (input.fileIds.length > MAX_CONTEXT_FILES) {
    throw new Error(`Attach at most ${MAX_CONTEXT_FILES} files.`);
  }

  let totalBytes = 0;
  const contextFiles: JobContextFile[] = [];

  for (const fileId of input.fileIds) {
    const file = await fetchSlackFileInfo(input.client, fileId);
    const fileName = file.name?.trim() || `slack-file-${file.id}`;

    if (!isAllowedSlackContextFile(file)) {
      throw new Error(`Unsupported file type for ${fileName}. Use images or small text files.`);
    }
    if (typeof file.size === 'number' && file.size > MAX_CONTEXT_FILE_BYTES) {
      throw new Error(
        `${fileName} exceeds the ${Math.floor(MAX_CONTEXT_FILE_BYTES / (1024 * 1024))} MiB limit.`,
      );
    }

    const content = await downloadSlackFile(input.botToken, file);
    if (content.byteLength > MAX_CONTEXT_FILE_BYTES) {
      throw new Error(
        `${fileName} exceeds the ${Math.floor(MAX_CONTEXT_FILE_BYTES / (1024 * 1024))} MiB limit.`,
      );
    }
    totalBytes += content.byteLength;
    if (totalBytes > MAX_CONTEXT_TOTAL_BYTES) {
      throw new Error(
        `Attached files exceed the ${Math.floor(MAX_CONTEXT_TOTAL_BYTES / (1024 * 1024))} MiB total limit.`,
      );
    }

    const sourceMetadata: Record<string, string> = {};
    if (file.filetype?.trim()) {
      sourceMetadata.filetype = file.filetype.trim();
    }

    contextFiles.push({
      originalName: fileName,
      mediaType: file.mimetype?.trim() || 'application/octet-stream',
      byteSize: content.byteLength,
      contentBase64: content.toString('base64'),
      source: {
        provider: 'slack',
        externalId: file.id,
        ...(Object.keys(sourceMetadata).length ? { metadata: sourceMetadata } : {}),
      },
    });
  }

  return contextFiles;
}

export async function loadSlackModalContextFiles(input: {
  client: App['client'];
  botToken?: string | undefined;
  state: SlackViewStateValues;
}): Promise<JobContextFile[]> {
  return loadSlackContextFilesByIds({
    client: input.client,
    botToken: input.botToken,
    fileIds: getSubmittedSlackContextFileIds(input.state),
  });
}

export async function loadSlackMentionContextFiles(input: {
  client: App['client'];
  botToken?: string | undefined;
  channelId: string;
  threadTs: string;
  messageTs: string;
}): Promise<JobContextFile[]> {
  const response = await input.client.conversations.replies({
    channel: input.channelId,
    ts: input.threadTs,
    oldest: input.messageTs,
    inclusive: true,
    limit: 1,
  });
  const messages = ((response as { messages?: SlackReplyMessage[] }).messages ?? []).filter(
    (message): message is SlackReplyMessage => Boolean(message.ts),
  );
  const triggeringMessage = messages[0];

  if (!triggeringMessage || triggeringMessage.ts !== input.messageTs) {
    throw new Error('Slack could not resolve the triggering mention message.');
  }

  return loadSlackContextFilesByIds({
    client: input.client,
    botToken: input.botToken,
    fileIds: getUniqueSlackContextFileIds(triggeringMessage.files),
  });
}

function escapeSlackMrkdwn(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

function formatContextFileSize(byteSize: number): string {
  if (byteSize < 1024) {
    return `${byteSize} B`;
  }
  return `${Math.round(byteSize / 1024)} KiB`;
}

async function buildSlackContextBlocks(
  client: App['client'],
  contextFiles: JobContextFile[],
): Promise<Record<string, unknown>[]> {
  const blocks: Record<string, unknown>[] = [];
  const linkedFiles: string[] = [];

  for (const contextFile of contextFiles) {
    const sourceFileId =
      contextFile.source?.provider === 'slack' ? contextFile.source.externalId.trim() : '';
    let permalink: string | undefined;

    if (sourceFileId) {
      try {
        const file = await fetchSlackFileInfo(client, sourceFileId);
        permalink = file.permalink?.trim() || undefined;
      } catch (err) {
        logger.warn(
          { err, fileId: sourceFileId, fileName: contextFile.originalName },
          'Failed to resolve Slack context file metadata for message rendering',
        );
      }
    }

    if (contextFile.mediaType.startsWith('image/') && sourceFileId) {
      blocks.push({
        type: 'image',
        slack_file: { id: sourceFileId },
        alt_text: contextFile.originalName,
        title: {
          type: 'plain_text',
          text: contextFile.originalName.slice(0, 2000),
        },
      });
      continue;
    }

    const renderedName = escapeSlackMrkdwn(contextFile.originalName);
    const renderedDetails = escapeSlackMrkdwn(
      `${contextFile.mediaType}, ${formatContextFileSize(contextFile.byteSize)}`,
    );
    linkedFiles.push(
      permalink
        ? `- <${permalink}|${renderedName}> (${renderedDetails})`
        : `- ${renderedName} (${renderedDetails})`,
    );
  }

  if (linkedFiles.length) {
    blocks.unshift({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*Context files*\n${linkedFiles.join('\n')}`,
      },
    });
  }

  return blocks;
}

function resolveSlackClient(input: App | App['client']): App['client'] {
  return 'client' in input ? input.client : input;
}

async function debugProbeChannelAccess(client: App['client'], channelId: string): Promise<void> {
  try {
    const response = await client.conversations.info({ channel: channelId });
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
  app: App | App['client'],
  options: {
    channel: string;
    text: string;
    threadTs?: string;
    blocks?: unknown[];
    contextFiles?: JobContextFile[];
  },
): Promise<ChatPostMessageResponse> {
  const client = resolveSlackClient(app);
  const contextBlocks = options.contextFiles?.length
    ? await buildSlackContextBlocks(client, options.contextFiles)
    : [];
  const blocks =
    options.blocks && contextBlocks.length
      ? [...options.blocks, ...contextBlocks]
      : options.blocks
        ? options.blocks
        : contextBlocks.length
          ? [
              {
                type: 'section',
                text: {
                  type: 'mrkdwn',
                  text: options.text,
                },
              },
              ...contextBlocks,
            ]
          : undefined;
  const payload = {
    channel: options.channel,
    text: options.text,
    ...(options.threadTs && { thread_ts: options.threadTs }),
    ...(blocks && { blocks }),
  };

  if (isDebugNamespaceEnabled('slack')) {
    debugSlack(
      {
        api: 'chat.postMessage',
        channel: options.channel,
        threadTs: options.threadTs,
        hasBlocks: Boolean(blocks?.length),
        textLength: options.text.length,
      },
      'Slack API request',
    );
  }

  try {
    const response = await client.chat.postMessage(payload);
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
      await debugProbeChannelAccess(resolveSlackClient(app), options.channel);
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
