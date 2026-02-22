import type { Notifier } from './notifier.js';
import type { BotEventSink } from './botEventSink.js';
import { resolveWorkerChannelAdapter } from './workerChannelAdapters.js';

export function createNotifier(events: BotEventSink): Notifier {
  return {
    async postMessage(ref, text, options) {
      const adapter = resolveWorkerChannelAdapter(ref.provider);
      await events.publish(adapter.buildPostMessageEvent(ref, text, options));
    },
    async uploadFile(ref, file) {
      const adapter = resolveWorkerChannelAdapter(ref.provider);
      await events.publish(adapter.buildUploadFileEvent(ref, file));
    },
  };
}
