import { debugFor, logger } from '@sniptail/core/logger.js';
import type {
  BotEventPayloadMap,
  CoreBotEvent,
  CoreBotEventType,
} from '@sniptail/core/types/bot-event.js';
import { buildSlackIds } from '@sniptail/core/slack/ids.js';
import { loadBotConfig } from '@sniptail/core/config/config.js';
import { addReaction, postEphemeral, postMessage, uploadFile } from './helpers.js';
import { setAgentCommandMetadata } from '../agentCommandMetadataCache.js';
import {
  appendSlackAgentPermissionStatus,
  appendSlackAgentQuestionStatus,
  buildSlackAgentPermissionBlocks,
  buildSlackAgentPermissionRequestText,
  buildSlackAgentPermissionUpdateText,
  buildSlackAgentQuestionBlocks,
  buildSlackAgentQuestionRequestText,
  buildSlackAgentQuestionUpdateText,
  clearPendingSlackAgentQuestion,
  setPendingSlackAgentQuestion,
} from './agentCommandState.js';
import type {
  RuntimeBotChannelAdapter,
  BotEventRuntime,
} from '../channels/runtimeBotChannelAdapter.js';

type AgentInteractionMessageState = {
  ts: string;
  requestText: string;
};

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
    'agent.metadata.update',
    'agent.permission.requested',
    'agent.permission.updated',
    'agent.question.requested',
    'agent.question.updated',
  ] as const satisfies readonly CoreBotEventType[];

  async handleEvent(event: CoreBotEvent, runtime: BotEventRuntime): Promise<boolean> {
    if (event.provider !== this.providerId) {
      return false;
    }
    if (event.type === 'agent.metadata.update') {
      setAgentCommandMetadata(event.payload);
      return true;
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
      default:
        return false;
    }
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
    agentPermissionMessageTs.set(
      agentInteractionKey(event.payload.sessionId, event.payload.interactionId),
      {
        ts: message.ts ?? '',
        requestText,
      },
    );
  }

  private async updateAgentPermissionRequest(
    app: NonNullable<BotEventRuntime['slackApp']>,
    event: CoreBotEvent<'agent.permission.updated'>,
  ) {
    const key = agentInteractionKey(event.payload.sessionId, event.payload.interactionId);
    const messageState = agentPermissionMessageTs.get(key);
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
      agentPermissionMessageTs.delete(key);
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
