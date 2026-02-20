import { Worker } from 'bullmq';
import type { Job } from 'bullmq';
import type { App } from '@slack/bolt';
import type { Client } from 'discord.js';
import { logger } from '@sniptail/core/logger.js';
import { botEventQueueName, createConnectionOptions } from '@sniptail/core/queue/queue.js';
import type { BotEvent } from '@sniptail/core/types/bot-event.js';
import { resolveBotChannelAdapter } from './channels/botChannelAdapters.js';

type BotEventWorkerDeps = {
  redisUrl: string;
  slackApp?: App;
  discordClient?: Client;
};

export function startBotEventWorker({ redisUrl, slackApp, discordClient }: BotEventWorkerDeps) {
  const connection = createConnectionOptions(redisUrl);
  const worker = new Worker<BotEvent>(
    botEventQueueName,
    async (job) => {
      const event = job.data;
      const adapter = resolveBotChannelAdapter(event.provider);
      const handled = await adapter.handleEvent(event, {
        ...(slackApp ? { slackApp } : {}),
        ...(discordClient ? { discordClient } : {}),
      });
      if (!handled) {
        logger.warn(
          {
            provider: event.provider,
            type: event.type,
            supportedEventTypes: adapter.supportedEventTypes,
          },
          'Unhandled bot event',
        );
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
