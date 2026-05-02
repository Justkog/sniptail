import { logger } from '@sniptail/core/logger.js';
import type {
  BotEventPayloadMap,
  CoreBotEvent,
  CoreBotEventType,
} from '@sniptail/core/types/bot-event.js';
import { loadBotConfig } from '@sniptail/core/config/config.js';
import { toSlackCommandPrefix } from '@sniptail/core/utils/slack.js';
import {
  addDiscordReaction,
  editDiscordMessage,
  editDiscordInteractionReply,
  fetchDiscordMessage,
  postDiscordEphemeral,
  postDiscordMessage,
  uploadDiscordFile,
} from './helpers.js';
import { buildDiscordAgentPermissionComponents } from '@sniptail/core/discord/components.js';
import { setDiscordAgentCommandMetadata } from './agentCommandMetadataCache.js';
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
    reactions: true,
  } as const;
  supportedEventTypes = [
    'message.post',
    'file.upload',
    'reaction.add',
    'message.ephemeral',
    'interaction.reply.edit',
    'agent.metadata.update',
    'agent.permission.requested',
    'agent.permission.updated',
  ] as const satisfies readonly CoreBotEventType[];

  async handleEvent(event: CoreBotEvent, runtime: BotEventRuntime): Promise<boolean> {
    if (event.provider !== this.providerId) {
      return false;
    }
    if (event.type === 'agent.metadata.update') {
      setDiscordAgentCommandMetadata(event.payload);
      logger.info(
        {
          enabled: event.payload.enabled,
          workspaces: event.payload.workspaces.length,
          profiles: event.payload.profiles.length,
        },
        'Updated cached Discord agent command metadata',
      );
      return true;
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
      case 'reaction.add': {
        const payload = toReactionAddPayload(event.payload);
        if (!payload) {
          return false;
        }
        await addDiscordReaction(client, {
          channelId: payload.channelId,
          messageId: String(payload.messageId),
          name: payload.name,
          ...(payload.threadId ? { threadId: String(payload.threadId) } : {}),
        });
        return true;
      }
      case 'message.ephemeral':
        await postDiscordEphemeral(client, {
          channelId: event.payload.channelId,
          userId: event.payload.userId,
          text: event.payload.text,
          ...(event.payload.threadId ? { threadId: event.payload.threadId } : {}),
        });
        return true;
      case 'agent.permission.requested':
        await this.postAgentPermissionRequest(client, event);
        return true;
      case 'agent.permission.updated':
        await this.updateAgentPermissionRequest(client, event);
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

  private async postAgentPermissionRequest(
    client: Parameters<typeof postDiscordMessage>[0],
    event: CoreBotEvent<'agent.permission.requested'>,
  ) {
    const message = await postDiscordMessage(client, {
      channelId: event.payload.channelId,
      threadId: event.payload.threadId,
      text: buildAgentPermissionRequestText(event.payload),
      components: buildDiscordAgentPermissionComponents(
        event.payload.sessionId,
        event.payload.interactionId,
        { allowAlways: event.payload.allowAlways },
      ),
    });
    agentPermissionMessageIds.set(
      agentPermissionKey(event.payload.sessionId, event.payload.interactionId),
      message.id,
    );
  }

  private async updateAgentPermissionRequest(
    client: Parameters<typeof postDiscordMessage>[0],
    event: CoreBotEvent<'agent.permission.updated'>,
  ) {
    const key = agentPermissionKey(event.payload.sessionId, event.payload.interactionId);
    const messageId = agentPermissionMessageIds.get(key);
    if (messageId) {
      try {
        const existingMessage = await fetchDiscordMessage(client, {
          channelId: event.payload.channelId,
          threadId: event.payload.threadId,
          messageId,
        });
        await editDiscordMessage(client, {
          channelId: event.payload.channelId,
          threadId: event.payload.threadId,
          messageId,
          text: appendAgentPermissionStatus(existingMessage.content, event.payload),
          components: [],
        });
        agentPermissionMessageIds.delete(key);
        return;
      } catch (err) {
        logger.warn(
          {
            err,
            sessionId: event.payload.sessionId,
            interactionId: event.payload.interactionId,
            channelId: event.payload.channelId,
            threadId: event.payload.threadId,
            messageId,
            cacheSize: agentPermissionMessageIds.size,
            pid: process.pid,
          },
          'Failed to edit Discord agent permission message',
        );
      }
    } else {
      logger.warn(
        {
          sessionId: event.payload.sessionId,
          interactionId: event.payload.interactionId,
          channelId: event.payload.channelId,
          threadId: event.payload.threadId,
          knownKeys: Array.from(agentPermissionMessageIds.keys()).slice(0, 10),
          cacheSize: agentPermissionMessageIds.size,
          pid: process.pid,
        },
        'Discord agent permission message id was not found in local cache',
      );
    }
    logger.info(
      {
        sessionId: event.payload.sessionId,
        interactionId: event.payload.interactionId,
        channelId: event.payload.channelId,
        threadId: event.payload.threadId,
        status: event.payload.status,
        pid: process.pid,
      },
      'Posting fallback Discord agent permission update message',
    );
    await postDiscordMessage(client, {
      channelId: event.payload.channelId,
      threadId: event.payload.threadId,
      text: buildAgentPermissionUpdateText(event.payload),
    });
  }
}

function agentPermissionKey(sessionId: string, interactionId: string): string {
  return `${sessionId}:${interactionId}`;
}

const agentPermissionMessageIds = new Map<string, string>();

function buildAgentPermissionRequestText(
  payload: CoreBotEvent<'agent.permission.requested'>['payload'],
): string {
  const lines = [
    '**Permission requested**',
    '',
    payload.toolName ? `Tool: \`${payload.toolName}\`` : undefined,
    payload.action ? `Action: \`${payload.action}\`` : undefined,
    `Workspace: \`${payload.workspaceKey}${payload.cwd ? ` / ${payload.cwd}` : ''}\``,
    `Expires: <t:${Math.floor(Date.parse(payload.expiresAt) / 1000)}:R>`,
  ];
  if (payload.details?.length) {
    lines.push('', 'Details:', ...payload.details.map((detail) => `\`${detail}\``));
  }
  return lines.filter((line) => line !== undefined).join('\n');
}

function buildAgentPermissionUpdateText(
  payload: CoreBotEvent<'agent.permission.updated'>['payload'],
): string {
  const actor = payload.actorUserId ? ` by <@${payload.actorUserId}>` : '';
  const statusText =
    payload.status === 'approved_once'
      ? `Permission approved once${actor}.`
      : payload.status === 'approved_always'
        ? `Permission always allowed${actor}.`
        : payload.status === 'rejected'
          ? `Permission rejected${actor}.`
          : payload.status === 'expired'
            ? 'Permission request expired and was rejected.'
            : 'Permission request failed.';
  return statusText;
}

function stripTrailingPermissionStatus(text: string): string {
  const markers = [
    '\n\nApprove once selected by ',
    '\n\nAlways allow selected by ',
    '\n\nReject selected by ',
  ];
  for (const marker of markers) {
    const markerIndex = text.lastIndexOf(marker);
    if (markerIndex !== -1) {
      return text.slice(0, markerIndex).trim();
    }
  }
  return text.trim();
}

function appendAgentPermissionStatus(
  existingText: string,
  payload: CoreBotEvent<'agent.permission.updated'>['payload'],
): string {
  const base = stripTrailingPermissionStatus(existingText) || 'Permission requested';
  return `${base}\n\n${buildAgentPermissionUpdateText(payload)}`;
}

function toReactionAddPayload(
  payload: CoreBotEvent['payload'],
): BotEventPayloadMap['reaction.add'] | undefined {
  const candidate = payload as Record<string, unknown>;
  const channelId = candidate.channelId;
  const messageId = candidate.messageId;
  const name = candidate.name;
  const threadId = candidate.threadId;
  if (typeof channelId !== 'string' || typeof messageId !== 'string' || typeof name !== 'string') {
    return undefined;
  }
  return {
    channelId,
    messageId,
    name,
    ...(typeof threadId === 'string' ? { threadId } : {}),
  };
}

const DISCORD_MESSAGE_CONTENT_LIMIT = 2000;
let overflowFileBotNamePrefix: string | undefined;

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
  const botNamePrefix = resolveOverflowFileBotNamePrefix();
  if (!jobId?.trim()) {
    return `${botNamePrefix}-discord-message.md`;
  }
  const sanitizedJobId = sanitizeFileNameSegment(jobId);
  if (!sanitizedJobId) {
    return `${botNamePrefix}-discord-message.md`;
  }
  return `${botNamePrefix}-${sanitizedJobId}-message.md`;
}

function resolveOverflowFileBotNamePrefix(): string {
  if (overflowFileBotNamePrefix) {
    return overflowFileBotNamePrefix;
  }
  overflowFileBotNamePrefix = toSlackCommandPrefix(loadBotConfig().botName);
  return overflowFileBotNamePrefix;
}

function sanitizeFileNameSegment(value: string): string {
  return value
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}
