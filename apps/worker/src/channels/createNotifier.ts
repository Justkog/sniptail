import type { Queue } from 'bullmq';
import type { BotEvent } from '@sniptail/core/types/bot-event.js';
import { enqueueBotEvent } from '@sniptail/core/queue/queue.js';
import type { Notifier } from './notifier.js';

export function createNotifier(queue: Queue<BotEvent>): Notifier {
  return {
    async postMessage(ref, text, options) {
      await enqueueBotEvent(queue, {
        provider: ref.provider,
        type: 'postMessage',
        payload: {
          channelId: ref.channelId,
          text,
          ...(ref.threadId ? { threadId: ref.threadId } : {}),
          ...(ref.provider === 'slack' && options?.blocks ? { blocks: options.blocks } : {}),
          ...(ref.provider === 'discord' && options?.components
            ? { components: options.components }
            : {}),
        },
      });
    },
    async uploadFile(ref, file) {
      await enqueueBotEvent(queue, {
        provider: ref.provider,
        type: 'uploadFile',
        payload: {
          channelId: ref.channelId,
          filePath: file.filePath,
          title: file.title,
          ...(ref.threadId ? { threadId: ref.threadId } : {}),
        },
      });
    },
  };
}
