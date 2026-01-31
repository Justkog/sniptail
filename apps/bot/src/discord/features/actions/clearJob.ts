import type { ButtonInteraction } from 'discord.js';
import type { Queue } from 'bullmq';
import { logger } from '@sniptail/core/logger.js';
import { enqueueWorkerEvent } from '@sniptail/core/queue/queue.js';
import type { WorkerEvent } from '@sniptail/core/types/worker-event.js';
import { buildDiscordClearJobConfirmComponents } from '@sniptail/core/discord/components.js';

export async function handleClearJobButton(interaction: ButtonInteraction, jobId: string) {
  await interaction.reply({
    content: `Clear job data for ${jobId}?`,
    components: buildDiscordClearJobConfirmComponents(jobId),
    ephemeral: true,
  });
}

export async function handleClearJobConfirmButton(
  interaction: ButtonInteraction,
  jobId: string,
  workerEventQueue: Queue<WorkerEvent>,
) {
  try {
    await enqueueWorkerEvent(workerEventQueue, {
      type: 'clearJob',
      payload: {
        jobId,
        ttlMs: 5 * 60_000,
      },
    });
    await interaction.update({
      content: `Job ${jobId} will be cleared in 5 minutes.`,
      components: [],
    });
  } catch (err) {
    logger.error({ err, jobId }, 'Failed to schedule job deletion');
    await interaction.update({
      content: `Failed to schedule deletion for job ${jobId}.`,
      components: [],
    });
  }
}

export async function handleClearJobCancelButton(interaction: ButtonInteraction, jobId: string) {
  await interaction.update({
    content: `Job ${jobId} clear cancelled.`,
    components: [],
  });
}
