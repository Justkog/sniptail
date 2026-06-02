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
import {
  buildDiscordAgentSessionTimestamp,
  DISCORD_AGENT_SESSIONS_PAGE_SIZE,
  discordAgentSessionFiltersEqual,
} from './discordAgentSessionBrowserShared.js';
import {
  clearPendingDiscordAgentSessionBrowserRequest,
  getPendingDiscordAgentSessionBrowserRequest,
  setDiscordAgentSessionsActionState,
  type PendingDiscordAgentSessionBrowserRequest,
} from './state.js';
import { buildDiscordAgentSessionsCustomId } from './features/actions/discordAgentSessionButtons.js';
import {
  buildDiscordAgentPermissionComponents,
  buildDiscordAgentQuestionComponents,
} from '@sniptail/core/discord/components.js';
import {
  clearPendingDiscordAgentQuestion,
  setPendingDiscordAgentQuestion,
} from './features/actions/agentQuestion.js';
import type {
  RuntimeBotChannelAdapter,
  BotEventRuntime,
} from '../channels/runtimeBotChannelAdapter.js';

export type AgentPermissionMessageState = {
  messageId: string;
  requestText: string;
};

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
    'agent.permission.requested',
    'agent.permission.updated',
    'agent.question.requested',
    'agent.question.updated',
    'agent.sessions.listed',
    'agent.session.previewed',
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
      case 'agent.question.requested':
        await this.postAgentQuestionRequest(client, event);
        return true;
      case 'agent.question.updated':
        await this.updateAgentQuestionRequest(client, event);
        return true;
      case 'agent.sessions.listed':
        await this.postAgentSessionsListed(client, event);
        return true;
      case 'agent.session.previewed':
        await this.postAgentSessionPreviewed(client, event);
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
  }

  private async postAgentPermissionRequest(
    client: Parameters<typeof postDiscordMessage>[0],
    event: CoreBotEvent<'agent.permission.requested'>,
  ) {
    const requestText = buildAgentPermissionRequestText(event.payload);
    const message = await postDiscordMessage(client, {
      channelId: event.payload.channelId,
      threadId: event.payload.threadId,
      text: requestText,
      components: buildDiscordAgentPermissionComponents(
        event.payload.sessionId,
        event.payload.interactionId,
        { allowAlways: event.payload.allowAlways },
      ),
    });
    setDiscordAgentPermissionMessageState(event.payload.sessionId, event.payload.interactionId, {
      messageId: message.id,
      requestText,
    });
  }

  private async updateAgentPermissionRequest(
    client: Parameters<typeof postDiscordMessage>[0],
    event: CoreBotEvent<'agent.permission.updated'>,
  ) {
    const messageState = getDiscordAgentPermissionMessageState(
      event.payload.sessionId,
      event.payload.interactionId,
    );
    if (messageState?.messageId) {
      try {
        const existingMessage = await fetchDiscordMessage(client, {
          channelId: event.payload.channelId,
          threadId: event.payload.threadId,
          messageId: messageState.messageId,
        });
        await editDiscordMessage(client, {
          channelId: event.payload.channelId,
          threadId: event.payload.threadId,
          messageId: messageState.messageId,
          text: appendAgentPermissionStatus(
            messageState.requestText || existingMessage.content,
            event.payload,
          ),
          components: [],
        });
        clearDiscordAgentPermissionMessageState(
          event.payload.sessionId,
          event.payload.interactionId,
        );
        return;
      } catch (err) {
        logger.warn(
          {
            err,
            sessionId: event.payload.sessionId,
            interactionId: event.payload.interactionId,
            channelId: event.payload.channelId,
            threadId: event.payload.threadId,
            messageId: messageState.messageId,
            cacheSize: agentPermissionMessages.size,
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
          knownKeys: Array.from(agentPermissionMessages.keys()).slice(0, 10),
          cacheSize: agentPermissionMessages.size,
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

  private async postAgentQuestionRequest(
    client: Parameters<typeof postDiscordMessage>[0],
    event: CoreBotEvent<'agent.question.requested'>,
  ) {
    setPendingDiscordAgentQuestion(event.payload);
    const message = await postDiscordMessage(client, {
      channelId: event.payload.channelId,
      threadId: event.payload.threadId,
      text: buildAgentQuestionRequestText(event.payload),
      components: buildDiscordAgentQuestionComponents(
        event.payload.sessionId,
        event.payload.interactionId,
        event.payload.questions,
      ),
    });
    agentQuestionMessageIds.set(
      agentQuestionKey(event.payload.sessionId, event.payload.interactionId),
      message.id,
    );
  }

  private async updateAgentQuestionRequest(
    client: Parameters<typeof postDiscordMessage>[0],
    event: CoreBotEvent<'agent.question.updated'>,
  ) {
    const key = agentQuestionKey(event.payload.sessionId, event.payload.interactionId);
    clearPendingDiscordAgentQuestion(event.payload.sessionId, event.payload.interactionId);
    const messageId = agentQuestionMessageIds.get(key);
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
          text: appendAgentQuestionStatus(existingMessage.content, event.payload),
          components: [],
        });
        agentQuestionMessageIds.delete(key);
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
            cacheSize: agentQuestionMessageIds.size,
            pid: process.pid,
          },
          'Failed to edit Discord agent question message',
        );
      }
    } else {
      logger.warn(
        {
          sessionId: event.payload.sessionId,
          interactionId: event.payload.interactionId,
          channelId: event.payload.channelId,
          threadId: event.payload.threadId,
          knownKeys: Array.from(agentQuestionMessageIds.keys()).slice(0, 10),
          cacheSize: agentQuestionMessageIds.size,
          pid: process.pid,
        },
        'Discord agent question message id was not found in local cache',
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
      'Posting fallback Discord agent question update message',
    );
    await postDiscordMessage(client, {
      channelId: event.payload.channelId,
      threadId: event.payload.threadId,
      text: buildAgentQuestionUpdateText(event.payload),
    });
  }

  private async postAgentSessionsListed(
    client: Parameters<typeof editDiscordInteractionReply>[0],
    event: CoreBotEvent<'agent.sessions.listed'>,
  ) {
    const requestId = event.requestId?.trim();
    if (!requestId) {
      return;
    }
    const pending = getPendingDiscordAgentSessionBrowserRequest(requestId);
    if (!pending || !matchesPendingDiscordBrowserRequest(pending, event)) {
      return;
    }
    clearPendingDiscordAgentSessionBrowserRequest(requestId);

    const { text, components } = buildDiscordAgentSessionsBrowserMessage(pending, event);
    await editDiscordInteractionReply(client, {
      interactionApplicationId: pending.interactionApplicationId,
      interactionToken: pending.interactionToken,
      text,
      components,
    });
  }

  private async postAgentSessionPreviewed(
    client: Parameters<typeof postDiscordMessage>[0],
    event: CoreBotEvent<'agent.session.previewed'>,
  ) {
    await postDiscordMessage(client, {
      channelId: event.payload.channelId,
      threadId: event.payload.threadId,
      text: buildAgentSessionPreviewText(event),
    });
  }
}

function matchesPendingDiscordBrowserRequest(
  pending: PendingDiscordAgentSessionBrowserRequest,
  event: CoreBotEvent<'agent.sessions.listed'>,
): boolean {
  return (
    pending.channelId === event.payload.channelId &&
    pending.userId === event.payload.userId &&
    pending.guildId === event.payload.guildId &&
    pending.workerId === event.payload.workerId &&
    pending.agentProfileKey === event.payload.agentProfileKey &&
    discordAgentSessionFiltersEqual(pending.filters, event.payload.filters)
  );
}

function truncateDiscordMessage(value: string, maxLength = DISCORD_MESSAGE_CONTENT_LIMIT): string {
  return value.length <= maxLength ? value : `${value.slice(0, maxLength - 3)}...`;
}

function escapeDiscordCodeBlock(value: string): string {
  return value.replaceAll('```', "'''");
}

function buildAgentSessionPreviewText(event: CoreBotEvent<'agent.session.previewed'>): string {
  const lines = ['**Last message from attached session**'];

  if (event.payload.errorMessage || !event.payload.message) {
    lines.push(
      '',
      event.payload.errorMessage ??
        'Sniptail attached the session, but no last-message preview was available.',
    );
    return truncateDiscordMessage(lines.join('\n'));
  }

  const createdAtMs = event.payload.message.createdAt
    ? Date.parse(event.payload.message.createdAt)
    : Number.NaN;
  const createdAt = Number.isFinite(createdAtMs)
    ? ` at <t:${Math.floor(createdAtMs / 1000)}:f>`
    : '';
  const role = event.payload.message.role === 'agent' ? 'Agent' : 'User';
  lines.push(
    '',
    `${role}${createdAt}:`,
    '```',
    escapeDiscordCodeBlock(event.payload.message.text.trim()),
    '```',
  );

  return truncateDiscordMessage(lines.join('\n'));
}

function buildDiscordAgentSessionsBrowserMessage(
  pending: PendingDiscordAgentSessionBrowserRequest,
  event: CoreBotEvent<'agent.sessions.listed'>,
): { text: string; components: unknown[] } {
  const header = [
    '**Agent sessions**',
    `Worker: \`${pending.workerId}\``,
    pending.agentProfileKey ? `Profile: \`${pending.agentProfileKey}\`` : 'Profile: all listable',
    pending.filters?.workspaceKey
      ? `Workspace: \`${pending.filters.workspaceKey}${pending.filters.cwd ? ` / ${pending.filters.cwd}` : ''}\``
      : undefined,
  ]
    .filter((line) => line !== undefined)
    .join('\n');

  if (event.payload.errorMessage) {
    return {
      text: `${header}\n\n${event.payload.errorMessage}`,
      components: [],
    };
  }

  const lines = [header];
  if (!event.payload.sessions.length) {
    lines.push('', 'No matching sessions were found.');
  }

  const components: unknown[] = [];
  const renderedSessions = event.payload.sessions.slice(0, DISCORD_AGENT_SESSIONS_PAGE_SIZE);
  for (const [index, session] of renderedSessions.entries()) {
    const rowLines = [
      `**${index + 1}. ${truncateDiscordMessage(session.title?.trim() || 'Untitled session', 80)}**`,
      `Provider: \`${session.provider}\` | Profile: \`${session.agentProfileKey}\``,
      `Session ID: \`${session.id}\``,
      buildDiscordAgentSessionTimestamp(session),
      session.workspaceKey
        ? `Workspace: \`${session.workspaceKey}${session.cwd ? ` / ${session.cwd}` : ''}\``
        : session.cwd
          ? `CWD: \`${session.cwd}\``
          : undefined,
      session.project ? `Project: ${truncateDiscordMessage(session.project, 100)}` : undefined,
      session.roots?.length
        ? `Roots: ${session.roots.map((root) => `\`${root}\``).join(', ')}`
        : undefined,
      session.description ? truncateDiscordMessage(session.description, 160) : undefined,
    ].filter((line) => line !== undefined);
    lines.push('', ...rowLines);

    const token = setDiscordAgentSessionsActionState({
      kind: 'attach',
      payload: {
        channelId: pending.channelId,
        userId: pending.userId,
        ...(pending.guildId ? { guildId: pending.guildId } : {}),
        workerId: pending.workerId,
        ...(pending.agentProfileKey ? { agentProfileKey: pending.agentProfileKey } : {}),
        ...(pending.filters ? { filters: pending.filters } : {}),
        provider: session.provider,
        providerSessionId: session.id,
        sessionAgentProfileKey: session.agentProfileKey,
        ...(session.workspaceKey ? { workspaceKey: session.workspaceKey } : {}),
        ...(session.cwd ? { cwd: session.cwd } : {}),
        ...(session.title ? { title: session.title } : {}),
      },
    });
    components.push({
      type: 1,
      components: [
        {
          type: 2,
          style: 1,
          label: `Attach ${index + 1}`,
          custom_id: buildDiscordAgentSessionsCustomId('attach', token),
        },
      ],
    });
  }

  const navigationComponents: unknown[] = [];
  const previousCursor = event.payload.previousCursor ?? pending.cursorHistory.at(-1);
  if (event.payload.previousCursor || pending.cursorHistory.length > 0) {
    const token = setDiscordAgentSessionsActionState({
      kind: 'previous',
      payload: {
        channelId: pending.channelId,
        userId: pending.userId,
        ...(pending.guildId ? { guildId: pending.guildId } : {}),
        workerId: pending.workerId,
        ...(pending.agentProfileKey ? { agentProfileKey: pending.agentProfileKey } : {}),
        ...(pending.filters ? { filters: pending.filters } : {}),
        ...(pending.currentCursor ? { currentCursor: pending.currentCursor } : {}),
        cursorHistory: pending.cursorHistory,
        ...(previousCursor ? { previousCursor } : {}),
        ...(event.payload.nextCursor ? { nextCursor: event.payload.nextCursor } : {}),
      },
    });
    navigationComponents.push({
      type: 2,
      style: 2,
      label: 'Previous',
      custom_id: buildDiscordAgentSessionsCustomId('previous', token),
    });
  }
  if (event.payload.nextCursor) {
    const token = setDiscordAgentSessionsActionState({
      kind: 'next',
      payload: {
        channelId: pending.channelId,
        userId: pending.userId,
        ...(pending.guildId ? { guildId: pending.guildId } : {}),
        workerId: pending.workerId,
        ...(pending.agentProfileKey ? { agentProfileKey: pending.agentProfileKey } : {}),
        ...(pending.filters ? { filters: pending.filters } : {}),
        ...(pending.currentCursor ? { currentCursor: pending.currentCursor } : {}),
        cursorHistory: pending.cursorHistory,
        nextCursor: event.payload.nextCursor,
      },
    });
    navigationComponents.push({
      type: 2,
      style: 1,
      label: 'Next',
      custom_id: buildDiscordAgentSessionsCustomId('next', token),
    });
  }
  if (navigationComponents.length) {
    components.push({
      type: 1,
      components: navigationComponents,
    });
  }

  return {
    text: truncateDiscordMessage(lines.join('\n')),
    components,
  };
}

function agentPermissionKey(sessionId: string, interactionId: string): string {
  return `${sessionId}:${interactionId}`;
}

const agentPermissionMessages = new Map<string, AgentPermissionMessageState>();

export function getDiscordAgentPermissionMessageState(
  sessionId: string,
  interactionId: string,
): AgentPermissionMessageState | undefined {
  return agentPermissionMessages.get(agentPermissionKey(sessionId, interactionId));
}

export function setDiscordAgentPermissionMessageState(
  sessionId: string,
  interactionId: string,
  state: AgentPermissionMessageState,
): void {
  agentPermissionMessages.set(agentPermissionKey(sessionId, interactionId), state);
}

export function clearDiscordAgentPermissionMessageState(
  sessionId: string,
  interactionId: string,
): void {
  agentPermissionMessages.delete(agentPermissionKey(sessionId, interactionId));
}

function agentQuestionKey(sessionId: string, interactionId: string): string {
  return `${sessionId}:${interactionId}`;
}

const agentQuestionMessageIds = new Map<string, string>();

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

function buildAgentQuestionRequestText(
  payload: CoreBotEvent<'agent.question.requested'>['payload'],
): string {
  const lines = [
    '**Question requested**',
    '',
    `Workspace: \`${payload.workspaceKey}${payload.cwd ? ` / ${payload.cwd}` : ''}\``,
    `Expires: <t:${Math.floor(Date.parse(payload.expiresAt) / 1000)}:R>`,
  ];
  const hasMultipleQuestions = payload.questions.length > 1;
  payload.questions.forEach((question, index) => {
    const header = question.header?.trim();
    const title = hasMultipleQuestions
      ? `**${index + 1}. ${header || `Question ${index + 1}`}**`
      : header
        ? `**${header}**`
        : undefined;
    lines.push('');
    if (title) {
      lines.push(title);
    }
    lines.push(question.question);
    if (question.options.length) {
      const optionLabels = question.options
        .slice(0, 25)
        .map((option) => `- ${option.label}${option.description ? `: ${option.description}` : ''}`);
      lines.push(...optionLabels);
      if (question.options.length > 25) {
        lines.push(
          `_${question.options.length - 25} additional options hidden by Discord limits._`,
        );
      }
    }
    if (question.multiple) {
      lines.push('_Multiple choices allowed._');
    }
    if (question.custom) {
      lines.push('_Custom answer allowed._');
    }
  });
  return lines.join('\n');
}

function buildAgentQuestionUpdateText(
  payload: CoreBotEvent<'agent.question.updated'>['payload'],
): string {
  const actor = payload.actorUserId ? ` by <@${payload.actorUserId}>` : '';
  if (payload.status === 'answered') return `Question answered${actor}.`;
  if (payload.status === 'rejected') return `Question rejected${actor}.`;
  if (payload.status === 'expired') return 'Question request expired and was rejected.';
  return 'Question request failed.';
}

function stripTrailingQuestionStatus(text: string): string {
  const markers = [
    '\n\nQuestion answer selected by ',
    '\n\nQuestion rejected by ',
    '\n\nQuestion submitted by ',
  ];
  for (const marker of markers) {
    const markerIndex = text.lastIndexOf(marker);
    if (markerIndex !== -1) {
      return text.slice(0, markerIndex).trim();
    }
  }
  return text.trim();
}

function appendAgentQuestionStatus(
  existingText: string,
  payload: CoreBotEvent<'agent.question.updated'>['payload'],
): string {
  const base = stripTrailingQuestionStatus(existingText) || 'Question requested';
  return `${base}\n\n${buildAgentQuestionUpdateText(payload)}`;
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
