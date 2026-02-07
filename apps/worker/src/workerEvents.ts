import { fetchCodexUsageMessage } from '@sniptail/core/codex/status.js';
import { logger } from '@sniptail/core/logger.js';
import type { WorkerEvent } from '@sniptail/core/types/worker-event.js';
import type { BotEventSink } from './channels/botEventSink.js';
import type { JobRegistry } from './job/jobRegistry.js';

export async function handleWorkerEvent(
  event: WorkerEvent,
  registry: JobRegistry,
  botEvents: BotEventSink,
): Promise<void> {
  switch (event.type) {
    case 'clearJob': {
      const { jobId, ttlMs } = event.payload;
      await registry.markJobForDeletion(jobId, ttlMs).catch((err) => {
        logger.error({ err, jobId }, 'Failed to schedule job deletion');
      });
      return;
    }
    case 'clearJobsBefore': {
      const cutoff = new Date(event.payload.cutoffIso);
      if (Number.isNaN(cutoff.getTime())) {
        logger.warn({ cutoffIso: event.payload.cutoffIso }, 'Invalid cutoff date');
        return;
      }
      await registry.clearJobsBefore(cutoff).catch((err) => {
        logger.error({ err, cutoffIso: event.payload.cutoffIso }, 'Failed to clear jobs');
      });
      return;
    }
    case 'codexUsage': {
      try {
        const { message } = await fetchCodexUsageMessage();
        if (event.payload.provider === 'slack') {
          await botEvents.publish({
            provider: 'slack',
            type: 'postEphemeral',
            payload: {
              channelId: event.payload.channelId,
              userId: event.payload.userId,
              text: message,
              ...(event.payload.threadId ? { threadId: event.payload.threadId } : {}),
            },
          });
        } else {
          await botEvents.publish({
            provider: 'discord',
            type: 'editInteractionReply',
            payload: {
              interactionApplicationId: event.payload.interactionApplicationId,
              interactionToken: event.payload.interactionToken,
              text: message,
            },
          });
        }
      } catch (err) {
        logger.error({ err }, 'Failed to fetch Codex usage status');
        if (event.payload.provider === 'slack') {
          await botEvents.publish({
            provider: 'slack',
            type: 'postEphemeral',
            payload: {
              channelId: event.payload.channelId,
              userId: event.payload.userId,
              text: 'Failed to fetch Codex usage status. Please try again shortly.',
              ...(event.payload.threadId ? { threadId: event.payload.threadId } : {}),
            },
          });
        } else {
          await botEvents.publish({
            provider: 'discord',
            type: 'editInteractionReply',
            payload: {
              interactionApplicationId: event.payload.interactionApplicationId,
              interactionToken: event.payload.interactionToken,
              text: 'Failed to fetch Codex usage status. Please try again shortly.',
            },
          });
        }
      }
      return;
    }
    default:
      logger.warn({ event }, 'Unknown worker event received');
  }
}
