import { Worker } from 'bullmq';
import type { Job } from 'bullmq';
import type { App } from '@slack/bolt';
import { logger } from '@sniptail/core/logger.js';
import { botEventQueueName, createConnectionOptions } from '@sniptail/core/queue/queue.js';
import type { BotEvent } from '@sniptail/core/types/bot-event.js';
import { addReaction, postMessage, uploadFile } from './slack/helpers.js';

export function startBotEventWorker(app: App, redisUrl: string) {
  const connection = createConnectionOptions(redisUrl);
  const worker = new Worker<BotEvent>(
    botEventQueueName,
    async (job) => {
      const event = job.data;
      switch (event.type) {
        case 'postMessage':
          await postMessage(app, event.payload);
          break;
        case 'uploadFile':
          await uploadFile(app, event.payload);
          break;
        case 'addReaction':
          await addReaction(app, event.payload);
          break;
        default:
          logger.warn({ event }, 'Unknown bot event received');
      }
    },
    { connection, concurrency: 4 },
  );

  worker.on('failed', (job: Job<BotEvent> | undefined, err: Error) => {
    logger.error({ jobId: job?.data?.jobId, err }, 'Bot event failed');
  });

  worker.on('completed', (job: Job<BotEvent> | undefined) => {
    logger.info({ jobId: job?.data?.jobId, type: job?.data?.type }, 'Bot event completed');
  });

  return worker;
}
