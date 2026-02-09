import type { Notifier } from './notifier.js';
import type { BotEventSink } from './botEventSink.js';

export function createNotifier(events: BotEventSink): Notifier {
  return {
    async postMessage(ref, text, options) {
      await events.publish({
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
      await events.publish({
        provider: ref.provider,
        type: 'uploadFile',
        payload: {
          channelId: ref.channelId,
          ...(file.filePath !== undefined ? { filePath: file.filePath } : {}),
          ...(file.fileContent !== undefined ? { fileContent: file.fileContent } : {}),
          title: file.title,
          ...(ref.threadId ? { threadId: ref.threadId } : {}),
        },
      });
    },
  };
}
