import type { ButtonInteraction } from 'discord.js';
import type { QueuePublisher } from '@sniptail/core/queue/queueTransportTypes.js';
import { logger } from '@sniptail/core/logger.js';
import { enqueueWorkerEvent } from '@sniptail/core/queue/queue.js';
import {
  WORKER_EVENT_SCHEMA_VERSION,
  type WorkerEvent,
} from '@sniptail/core/types/worker-event.js';
import { buildDiscordClearJobConfirmComponents } from '@sniptail/core/discord/components.js';
import { authorizeDiscordOperationAndRespond } from '../../permissions/discordPermissionGuards.js';
import type { PermissionsRuntimeService } from '../../../permissions/permissionsRuntimeService.js';

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
  workerEventQueue: QueuePublisher<WorkerEvent>,
  permissions: PermissionsRuntimeService,
) {
  const event: WorkerEvent = {
    schemaVersion: WORKER_EVENT_SCHEMA_VERSION,
    type: 'jobs.clear',
    payload: {
      jobId,
      ttlMs: 5 * 60_000,
    },
  };
  const authorized = await authorizeDiscordOperationAndRespond({
    permissions,
    action: 'jobs.clear',
    summary: `Clear job data for ${jobId}`,
    operation: {
      kind: 'enqueueWorkerEvent',
      event,
    },
    actor: {
      userId: interaction.user.id,
      channelId: interaction.channelId,
      ...(interaction.channel?.isThread() ? { threadId: interaction.channelId } : {}),
      ...(interaction.guildId ? { guildId: interaction.guildId } : {}),
      member: interaction.member,
    },
    client: interaction.client,
    onDeny: async () => {
      await interaction.update({
        content: 'You are not authorized to clear job data.',
        components: [],
      });
    },
    onRequireApprovalNotice: async (message) => {
      await interaction.update({
        content: message,
        components: [],
      });
    },
  });
  if (!authorized) {
    return;
  }

  try {
    await enqueueWorkerEvent(workerEventQueue, event);
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
