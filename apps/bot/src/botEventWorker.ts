import type { App } from '@slack/bolt';
import type { Client } from 'discord.js';
import { logger } from '@sniptail/core/logger.js';
import type {
  QueueConsumerHandle,
  QueueTransportRuntime,
} from '@sniptail/core/queue/queueTransportTypes.js';
import type { BotEvent } from '@sniptail/core/types/bot-event.js';
import { resolveBotChannelAdapter } from './channels/botChannelAdapters.js';

type BotEventWorkerDeps = {
  queueRuntime: QueueTransportRuntime;
  slackApp?: App;
  discordClient?: Client;
};

export function startBotEventWorker({
  queueRuntime,
  slackApp,
  discordClient,
}: BotEventWorkerDeps): QueueConsumerHandle {
  return queueRuntime.consumeBotEvents({
    concurrency: 4,
    handler: async (job) => {
      const event: BotEvent = job.data;
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
    onFailed: (job, err) => {
      logger.error({ jobId: job?.data?.jobId, err }, 'Bot event failed');
    },
    onCompleted: (job) => {
      logger.info({ jobId: job.data?.jobId, type: job.data?.type }, 'Bot event completed');
    },
  });
}
