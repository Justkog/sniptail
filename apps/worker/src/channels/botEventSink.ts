import type { QueuePublisher } from '@sniptail/core/queue/queueTransportTypes.js';
import { enqueueBotEvent } from '@sniptail/core/queue/queue.js';
import type { BotEvent } from '@sniptail/core/types/bot-event.js';

export interface BotEventSink {
  publish(event: BotEvent): Promise<void>;
  flush?: () => Promise<void>;
}

export class BullMqBotEventSink implements BotEventSink {
  constructor(private readonly queue: QueuePublisher<BotEvent>) {}

  async publish(event: BotEvent): Promise<void> {
    await enqueueBotEvent(this.queue, event);
  }
}

export class StdoutBotEventSink implements BotEventSink {
  async publish(event: BotEvent): Promise<void> {
    const payload = `${JSON.stringify(event)}\n`;
    if (!process.stdout.write(payload)) {
      await new Promise<void>((resolve) => {
        process.stdout.once('drain', resolve);
      });
    }
  }

  async flush(): Promise<void> {
    if (!process.stdout.writableNeedDrain) {
      return;
    }
    await new Promise<void>((resolve) => {
      process.stdout.once('drain', resolve);
    });
  }
}
