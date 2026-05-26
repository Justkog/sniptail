import { debugFor, logger } from '@sniptail/core/logger.js';
import type {
  BotEventPayloadMap,
  CoreBotEvent,
  CoreBotEventType,
} from '@sniptail/core/types/bot-event.js';
import { buildSlackIds } from '@sniptail/core/slack/ids.js';
import { loadBotConfig } from '@sniptail/core/config/config.js';
import { addReaction, postEphemeral, postMessage, uploadFile } from './helpers.js';
import {
  type PendingSlackAgentSessionBrowserRequest,
  appendSlackAgentPermissionStatus,
  appendSlackAgentQuestionStatus,
  buildSlackAgentPermissionBlocks,
  buildSlackAgentPermissionRequestText,
  buildSlackAgentPermissionUpdateText,
  buildSlackAgentQuestionBlocks,
  buildSlackAgentQuestionRequestText,
  buildSlackAgentQuestionUpdateText,
  clearPendingSlackAgentQuestion,
  clearPendingSlackAgentSessionBrowserRequest,
  getPendingSlackAgentSessionBrowserRequest,
  setPendingSlackAgentQuestion,
  setSlackAgentSessionsActionState,
} from './agentCommandState.js';
import {
  agentSessionListFiltersEqual,
  formatSlackAgentSessionTimestamp,
} from './agentSessionsShared.js';
import type {
  RuntimeBotChannelAdapter,
  BotEventRuntime,
} from '../channels/runtimeBotChannelAdapter.js';

type AgentInteractionMessageState = {
  ts: string;
  requestText: string;
};

export type AgentPermissionMessageState = AgentInteractionMessageState;

function escapeSlackMrkdwn(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

function matchesPendingBrowserRequest(
  pending: PendingSlackAgentSessionBrowserRequest,
  event: CoreBotEvent<'agent.sessions.listed'>,
): boolean {
  return (
    pending.channelId === event.payload.channelId &&
    pending.userId === event.payload.userId &&
    pending.workerId === event.payload.workerId &&
    pending.workspaceId === event.payload.workspaceId &&
    pending.agentProfileKey === event.payload.agentProfileKey &&
    agentSessionListFiltersEqual(pending.filters, event.payload.filters)
  );
}

export class SlackBotChannelAdapter implements RuntimeBotChannelAdapter {
  providerId = 'slack' as const;
  capabilities = {
    threads: true,
    richTextBlocks: true,
    ephemeralMessages: true,
    fileUploads: true,
    reactions: true,
  } as const;
  supportedEventTypes = [
    'message.post',
    'file.upload',
    'reaction.add',
    'message.ephemeral',
    'agent.permission.requested',
    'agent.permission.updated',
    'agent.question.requested',
    'agent.question.updated',
    'agent.sessions.listed',
  ] as const satisfies readonly CoreBotEventType[];

  async handleEvent(event: CoreBotEvent, runtime: BotEventRuntime): Promise<boolean> {
    if (event.provider !== this.providerId) {
      return false;
    }
    const app = runtime.slackApp;
    if (!app) {
      logger.warn({ event }, 'Slack bot event received without Slack app');
      return false;
    }

    debugSlack(
      {
        eventType: event.type,
        workspaceId: 'workspaceId' in event.payload ? event.payload.workspaceId : undefined,
        channelId: 'channelId' in event.payload ? event.payload.channelId : undefined,
        threadId: 'threadId' in event.payload ? event.payload.threadId : undefined,
      },
      'Handling Slack bot event',
    );

    switch (event.type) {
      case 'message.post':
        await postMessage(app, {
          channel: event.payload.channelId,
          text: event.payload.text,
          ...(event.payload.threadId ? { threadTs: event.payload.threadId } : {}),
          ...(event.payload.blocks ? { blocks: event.payload.blocks } : {}),
        });
        return true;
      case 'file.upload': {
        const baseOptions = {
          channel: event.payload.channelId,
          title: event.payload.title,
          ...(event.payload.threadId ? { threadTs: event.payload.threadId } : {}),
        };
        const options =
          'filePath' in event.payload
            ? { ...baseOptions, filePath: event.payload.filePath }
            : { ...baseOptions, fileContent: event.payload.fileContent };
        await uploadFile(app, options);
        return true;
      }
      case 'reaction.add': {
        const payload = toReactionAddPayload(event.payload);
        if (!payload) {
          return false;
        }
        await addReaction(app, {
          channel: payload.channelId,
          messageId: String(payload.messageId),
          name: payload.name,
        });
        return true;
      }
      case 'message.ephemeral':
        await postEphemeral(app, {
          channel: event.payload.channelId,
          user: event.payload.userId,
          text: event.payload.text,
          ...(event.payload.threadId ? { threadTs: event.payload.threadId } : {}),
          ...(event.payload.blocks ? { blocks: event.payload.blocks } : {}),
        });
        return true;
      case 'agent.permission.requested':
        await this.postAgentPermissionRequest(app, event);
        return true;
      case 'agent.permission.updated':
        await this.updateAgentPermissionRequest(app, event);
        return true;
      case 'agent.question.requested':
        await this.postAgentQuestionRequest(app, event);
        return true;
      case 'agent.question.updated':
        await this.updateAgentQuestionRequest(app, event);
        return true;
      case 'agent.sessions.listed':
        await this.postAgentSessionsListed(app, event);
        return true;
      default:
        return false;
    }
  }

  private async postAgentSessionsListed(
    app: NonNullable<BotEventRuntime['slackApp']>,
    event: CoreBotEvent<'agent.sessions.listed'>,
  ) {
    const requestId = event.requestId?.trim();
    if (!requestId) {
      return;
    }

    const pending = getPendingSlackAgentSessionBrowserRequest(requestId);
    if (!pending) {
      return;
    }
    if (!matchesPendingBrowserRequest(pending, event)) {
      return;
    }

    clearPendingSlackAgentSessionBrowserRequest(requestId);

    const headerLines = [
      '*Agent sessions*',
      `Worker: \`${pending.workerId}\``,
      pending.agentProfileKey ? `Profile: \`${pending.agentProfileKey}\`` : 'Profile: all listable',
      pending.filters?.workspaceKey
        ? `Workspace: \`${pending.filters.workspaceKey}${pending.filters.cwd ? ` / ${pending.filters.cwd}` : ''}\``
        : undefined,
    ].filter((line) => line !== undefined);

    const blocks: Record<string, unknown>[] = [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: headerLines.join('\n'),
        },
      },
    ];

    if (event.payload.errorMessage) {
      blocks.push({
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: event.payload.errorMessage,
        },
      });
      await postEphemeral(app, {
        channel: pending.channelId,
        user: pending.userId,
        text: event.payload.errorMessage,
        ...(pending.sourceThreadId ? { threadTs: pending.sourceThreadId } : {}),
        blocks,
      });
      return;
    }

    if (!event.payload.sessions.length) {
      blocks.push({
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: 'No matching sessions were found.',
        },
      });
    }

    for (const session of event.payload.sessions) {
      const attachToken = setSlackAgentSessionsActionState({
        kind: 'attach',
        payload: {
          channelId: pending.channelId,
          userId: pending.userId,
          workerId: pending.workerId,
          ...(pending.workspaceId ? { workspaceId: pending.workspaceId } : {}),
          ...(pending.sourceThreadId ? { sourceThreadId: pending.sourceThreadId } : {}),
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
      const lines = [
        `*${escapeSlackMrkdwn(session.title?.trim() || 'Untitled session')}*`,
        `Provider: \`${session.provider}\``,
        `Profile: \`${session.agentProfileKey}\``,
        `Session ID: \`${session.id}\``,
        formatSlackAgentSessionTimestamp(session),
        session.workspaceKey
          ? `Workspace: \`${session.workspaceKey}${session.cwd ? ` / ${session.cwd}` : ''}\``
          : session.cwd
            ? `CWD: \`${session.cwd}\``
            : undefined,
        session.project ? `Project: ${escapeSlackMrkdwn(session.project)}` : undefined,
        session.roots?.length
          ? `Roots: ${session.roots.map((root) => `\`${root}\``).join(', ')}`
          : undefined,
        session.description ? escapeSlackMrkdwn(session.description) : undefined,
      ].filter((line) => line !== undefined);
      blocks.push({
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: lines.join('\n'),
        },
        accessory: {
          type: 'button',
          text: {
            type: 'plain_text',
            text: 'Attach',
          },
          style: 'primary',
          action_id: buildSlackIds(loadBotConfig().botName).actions.agentSessionsAttach,
          value: attachToken,
        },
      });
    }

    const navigationElements: Record<string, unknown>[] = [];
    const previousCursor = event.payload.previousCursor ?? pending.cursorHistory.at(-1);
    if (event.payload.previousCursor || pending.cursorHistory.length > 0) {
      const previousToken = setSlackAgentSessionsActionState({
        kind: 'previous',
        payload: {
          channelId: pending.channelId,
          userId: pending.userId,
          workerId: pending.workerId,
          ...(pending.workspaceId ? { workspaceId: pending.workspaceId } : {}),
          ...(pending.sourceThreadId ? { sourceThreadId: pending.sourceThreadId } : {}),
          ...(pending.agentProfileKey ? { agentProfileKey: pending.agentProfileKey } : {}),
          ...(pending.filters ? { filters: pending.filters } : {}),
          ...(pending.currentCursor ? { currentCursor: pending.currentCursor } : {}),
          cursorHistory: pending.cursorHistory,
          ...(previousCursor ? { previousCursor } : {}),
          ...(event.payload.nextCursor ? { nextCursor: event.payload.nextCursor } : {}),
        },
      });
      navigationElements.push({
        type: 'button',
        text: {
          type: 'plain_text',
          text: 'Previous',
        },
        action_id: buildSlackIds(loadBotConfig().botName).actions.agentSessionsPrevious,
        value: previousToken,
      });
    }
    if (event.payload.nextCursor) {
      const nextToken = setSlackAgentSessionsActionState({
        kind: 'next',
        payload: {
          channelId: pending.channelId,
          userId: pending.userId,
          workerId: pending.workerId,
          ...(pending.workspaceId ? { workspaceId: pending.workspaceId } : {}),
          ...(pending.sourceThreadId ? { sourceThreadId: pending.sourceThreadId } : {}),
          ...(pending.agentProfileKey ? { agentProfileKey: pending.agentProfileKey } : {}),
          ...(pending.filters ? { filters: pending.filters } : {}),
          ...(pending.currentCursor ? { currentCursor: pending.currentCursor } : {}),
          cursorHistory: pending.cursorHistory,
          nextCursor: event.payload.nextCursor,
        },
      });
      navigationElements.push({
        type: 'button',
        text: {
          type: 'plain_text',
          text: 'Next',
        },
        action_id: buildSlackIds(loadBotConfig().botName).actions.agentSessionsNext,
        value: nextToken,
      });
    }
    if (navigationElements.length) {
      blocks.push({
        type: 'actions',
        elements: navigationElements,
      });
    }

    await postEphemeral(app, {
      channel: pending.channelId,
      user: pending.userId,
      text: event.payload.sessions.length
        ? 'Select a session to attach.'
        : 'No matching sessions were found.',
      ...(pending.sourceThreadId ? { threadTs: pending.sourceThreadId } : {}),
      blocks,
    });
  }

  private async postAgentPermissionRequest(
    app: NonNullable<BotEventRuntime['slackApp']>,
    event: CoreBotEvent<'agent.permission.requested'>,
  ) {
    const slackIds = buildSlackIds(loadBotConfig().botName);
    const requestText = buildSlackAgentPermissionRequestText(event.payload);
    const message = await postMessage(app, {
      channel: event.payload.channelId,
      text: requestText,
      ...(event.payload.threadId ? { threadTs: event.payload.threadId } : {}),
      blocks: [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: requestText,
          },
        },
        ...buildSlackAgentPermissionBlocks(event.payload, {
          once: slackIds.actions.agentPermissionOnce,
          always: slackIds.actions.agentPermissionAlways,
          reject: slackIds.actions.agentPermissionReject,
          stop: slackIds.actions.agentStop,
        }),
      ],
    });
    setSlackAgentPermissionMessageState(event.payload.sessionId, event.payload.interactionId, {
      ts: message.ts ?? '',
      requestText,
    });
  }

  private async updateAgentPermissionRequest(
    app: NonNullable<BotEventRuntime['slackApp']>,
    event: CoreBotEvent<'agent.permission.updated'>,
  ) {
    const messageState = getSlackAgentPermissionMessageState(
      event.payload.sessionId,
      event.payload.interactionId,
    );
    const text = messageState
      ? appendSlackAgentPermissionStatus(messageState.requestText, event.payload)
      : buildSlackAgentPermissionUpdateText(event.payload);
    if (messageState?.ts) {
      await app.client.chat.update({
        channel: event.payload.channelId,
        ts: messageState.ts,
        text,
        blocks: [],
      });
      clearSlackAgentPermissionMessageState(event.payload.sessionId, event.payload.interactionId);
      return;
    }
    await postMessage(app, {
      channel: event.payload.channelId,
      text,
      ...(event.payload.threadId ? { threadTs: event.payload.threadId } : {}),
    });
  }

  private async postAgentQuestionRequest(
    app: NonNullable<BotEventRuntime['slackApp']>,
    event: CoreBotEvent<'agent.question.requested'>,
  ) {
    const slackIds = buildSlackIds(loadBotConfig().botName);
    setPendingSlackAgentQuestion(event.payload);
    const requestText = buildSlackAgentQuestionRequestText(event.payload);
    const message = await postMessage(app, {
      channel: event.payload.channelId,
      text: requestText,
      ...(event.payload.threadId ? { threadTs: event.payload.threadId } : {}),
      blocks: [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: requestText,
          },
        },
        ...buildSlackAgentQuestionBlocks(event.payload, {
          select: slackIds.actions.agentQuestionSelect,
          submit: slackIds.actions.agentQuestionSubmit,
          reject: slackIds.actions.agentQuestionReject,
          custom: slackIds.actions.agentQuestionCustom,
          stop: slackIds.actions.agentStop,
        }),
      ],
    });
    agentQuestionMessageTs.set(
      agentInteractionKey(event.payload.sessionId, event.payload.interactionId),
      {
        ts: message.ts ?? '',
        requestText,
      },
    );
  }

  private async updateAgentQuestionRequest(
    app: NonNullable<BotEventRuntime['slackApp']>,
    event: CoreBotEvent<'agent.question.updated'>,
  ) {
    const key = agentInteractionKey(event.payload.sessionId, event.payload.interactionId);
    const messageState = agentQuestionMessageTs.get(key);
    clearPendingSlackAgentQuestion(event.payload.sessionId, event.payload.interactionId);
    const text = messageState
      ? appendSlackAgentQuestionStatus(messageState.requestText, event.payload)
      : buildSlackAgentQuestionUpdateText(event.payload);
    if (messageState?.ts) {
      await app.client.chat.update({
        channel: event.payload.channelId,
        ts: messageState.ts,
        text,
        blocks: [],
      });
      agentQuestionMessageTs.delete(key);
      return;
    }
    await postMessage(app, {
      channel: event.payload.channelId,
      text,
      ...(event.payload.threadId ? { threadTs: event.payload.threadId } : {}),
    });
  }
}

const debugSlack = debugFor('slack');

function agentInteractionKey(sessionId: string, interactionId: string): string {
  return `${sessionId}:${interactionId}`;
}

const agentPermissionMessageTs = new Map<string, AgentInteractionMessageState>();
const agentQuestionMessageTs = new Map<string, AgentInteractionMessageState>();

export function getSlackAgentPermissionMessageState(
  sessionId: string,
  interactionId: string,
): AgentPermissionMessageState | undefined {
  return agentPermissionMessageTs.get(agentInteractionKey(sessionId, interactionId));
}

export function setSlackAgentPermissionMessageState(
  sessionId: string,
  interactionId: string,
  state: AgentPermissionMessageState,
): void {
  agentPermissionMessageTs.set(agentInteractionKey(sessionId, interactionId), state);
}

export function clearSlackAgentPermissionMessageState(
  sessionId: string,
  interactionId: string,
): void {
  agentPermissionMessageTs.delete(agentInteractionKey(sessionId, interactionId));
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
