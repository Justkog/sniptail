import type { Queue } from 'bullmq';
import type { BotEvent } from '@sniptail/core/types/bot-event.js';
import type { FileUpload, MessageOptions, Notifier, ChannelRef } from './notifier.js';
import { enqueueBotEvent } from '@sniptail/core/queue/queue.js';

export function createSlackNotifier(queue: Queue<BotEvent>): Notifier {
  return {
    async postMessage(ref: ChannelRef, text: string, options?: MessageOptions) {
      await enqueueBotEvent(queue, {
        type: 'postMessage',
        payload: {
          channel: ref.channelId,
          text,
          ...(ref.threadId ? { threadTs: ref.threadId } : {}),
          ...(options?.blocks ? { blocks: options.blocks } : {}),
        },
      });
    },
    async uploadFile(ref: ChannelRef, file: FileUpload) {
      await enqueueBotEvent(queue, {
        type: 'uploadFile',
        payload: {
          channel: ref.channelId,
          filePath: file.filePath,
          title: file.title,
          ...(ref.threadId ? { threadTs: ref.threadId } : {}),
        },
      });
    },
  };
}
