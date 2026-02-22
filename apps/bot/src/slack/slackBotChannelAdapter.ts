import { logger } from '@sniptail/core/logger.js';
import type { CoreBotEvent, CoreBotEventType } from '@sniptail/core/types/bot-event.js';
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
      case 'reaction.add':
        await addReaction(app, {
          channel: event.payload.channelId,
          name: event.payload.name,
          timestamp: event.payload.timestamp,
        });
        return true;
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
