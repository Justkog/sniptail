import { Worker } from 'bullmq';
import type { Job } from 'bullmq';
import type { App } from '@slack/bolt';
import type { Client } from 'discord.js';
import { logger } from '@sniptail/core/logger.js';
import { botEventQueueName, createConnectionOptions } from '@sniptail/core/queue/queue.js';
import type { BotEvent } from '@sniptail/core/types/bot-event.js';
import { addReaction, postEphemeral, postMessage, uploadFile } from './slack/helpers.js';
import { editDiscordInteractionReply, postDiscordMessage, uploadDiscordFile } from './discord/helpers.js';

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
      if (event.provider === 'slack') {
        if (!slackApp) {
          logger.warn({ event }, 'Slack bot event received without Slack app');
          return;
        }
        switch (event.type) {
          case 'postMessage':
            await postMessage(slackApp, {
              channel: event.payload.channelId,
              text: event.payload.text,
              ...(event.payload.threadId ? { threadTs: event.payload.threadId } : {}),
              ...(event.payload.blocks ? { blocks: event.payload.blocks } : {}),
            });
            break;
          case 'uploadFile':
            await uploadFile(slackApp, {
              channel: event.payload.channelId,
              filePath: event.payload.filePath,
              title: event.payload.title,
              ...(event.payload.threadId ? { threadTs: event.payload.threadId } : {}),
            });
            break;
          case 'addReaction':
            await addReaction(slackApp, {
              channel: event.payload.channelId,
              name: event.payload.name,
              timestamp: event.payload.timestamp,
            });
            break;
          case 'postEphemeral':
            await postEphemeral(slackApp, {
              channel: event.payload.channelId,
              user: event.payload.userId,
              text: event.payload.text,
              ...(event.payload.threadId ? { threadTs: event.payload.threadId } : {}),
              ...(event.payload.blocks ? { blocks: event.payload.blocks } : {}),
            });
            break;
          default:
            logger.warn({ event }, 'Unknown Slack bot event received');
        }
        return;
      }

      if (!discordClient) {
        logger.warn({ event }, 'Discord bot event received without Discord client');
        return;
      }
      switch (event.type) {
        case 'postMessage':
          await postDiscordMessage(discordClient, {
            channelId: event.payload.channelId,
            text: event.payload.text,
            ...(event.payload.threadId ? { threadId: event.payload.threadId } : {}),
            ...(event.payload.components ? { components: event.payload.components } : {}),
          });
          break;
        case 'uploadFile':
          await uploadDiscordFile(discordClient, {
            channelId: event.payload.channelId,
            filePath: event.payload.filePath,
            title: event.payload.title,
            ...(event.payload.threadId ? { threadId: event.payload.threadId } : {}),
          });
          break;
        case 'editInteractionReply':
          await editDiscordInteractionReply(discordClient, {
            interactionApplicationId: event.payload.interactionApplicationId,
            interactionToken: event.payload.interactionToken,
            text: event.payload.text,
          });
          break;
        default:
          logger.warn({ event }, 'Unknown Discord bot event received');
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
