import { debugFor, logger } from '@sniptail/core/logger.js';
import type {
  BotEventPayloadMap,
  CoreBotEvent,
  CoreBotEventType,
} from '@sniptail/core/types/bot-event.js';
import { addReaction, postEphemeral, postMessage, uploadFile } from './helpers.js';
import type {
  RuntimeBotChannelAdapter,
  BotEventRuntime,
} from '../channels/runtimeBotChannelAdapter.js';

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
      default:
        return false;
    }
  }
}

const debugSlack = debugFor('slack');

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
