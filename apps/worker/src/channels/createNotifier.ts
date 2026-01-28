import type { Queue } from 'bullmq';
import type { BotEvent } from '@sniptail/core/types/bot-event.js';
import type { Notifier } from './notifier.js';
import { createSlackNotifier } from './slackNotifier.js';

export function createNotifier(queue: Queue<BotEvent>): Notifier {
  return createSlackNotifier(queue);
}
