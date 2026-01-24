import type { Queue } from 'bullmq';
import { enqueueBotEvent } from '@sniptail/core/queue/index.js';
import type { BotEvent } from '@sniptail/core/types/bot-event.js';

export async function sendBotEvent(queue: Queue<BotEvent>, event: BotEvent) {
  await enqueueBotEvent(queue, event);
}
