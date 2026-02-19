import type { ChatInputCommandInteraction } from 'discord.js';
import type { Queue } from 'bullmq';
import { logger } from '@sniptail/core/logger.js';
import { enqueueWorkerEvent } from '@sniptail/core/queue/queue.js';
import {
  WORKER_EVENT_SCHEMA_VERSION,
  type WorkerEvent,
} from '@sniptail/core/types/worker-event.js';

export async function handleUsage(
  interaction: ChatInputCommandInteraction,
  workerEventQueue: Queue<WorkerEvent>,
) {
  try {
    await enqueueWorkerEvent(workerEventQueue, {
      schemaVersion: WORKER_EVENT_SCHEMA_VERSION,
      type: 'status.codexUsage',
      payload: {
        provider: 'discord',
        channelId: interaction.channelId,
        interactionToken: interaction.token,
        interactionApplicationId: interaction.applicationId,
      },
    });
    await interaction.editReply('Checking Codex usage...');
  } catch (err) {
    logger.error({ err }, 'Failed to fetch Codex usage status');
    await interaction.editReply('Failed to fetch Codex usage status. Please try again shortly.');
  }
}
