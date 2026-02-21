import type { ChatInputCommandInteraction } from 'discord.js';
import type { Queue } from 'bullmq';
import { logger } from '@sniptail/core/logger.js';
import { enqueueWorkerEvent } from '@sniptail/core/queue/queue.js';
import {
  WORKER_EVENT_SCHEMA_VERSION,
  type WorkerEvent,
} from '@sniptail/core/types/worker-event.js';
import { authorizeDiscordOperationAndRespond } from '../../permissions/discordPermissionGuards.js';
import type { PermissionsRuntimeService } from '../../../permissions/permissionsRuntimeService.js';

export async function handleUsage(
  interaction: ChatInputCommandInteraction,
  workerEventQueue: Queue<WorkerEvent>,
  permissions: PermissionsRuntimeService,
) {
  const event: WorkerEvent = {
    schemaVersion: WORKER_EVENT_SCHEMA_VERSION,
    type: 'status.codexUsage',
    payload: {
      provider: 'discord',
      channelId: interaction.channelId,
      interactionToken: interaction.token,
      interactionApplicationId: interaction.applicationId,
    },
  };
  const authorized = await authorizeDiscordOperationAndRespond({
    permissions,
    action: 'status.codexUsage',
    summary: 'Check Codex usage status',
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
      await interaction.editReply('You are not authorized to check Codex usage.');
    },
    onRequireApprovalNotice: async (message) => {
      await interaction.editReply(message);
    },
  });
  if (!authorized) {
    return;
  }

  try {
    await enqueueWorkerEvent(workerEventQueue, event);
    await interaction.editReply('Checking Codex usage...');
  } catch (err) {
    logger.error({ err }, 'Failed to fetch Codex usage status');
    await interaction.editReply('Failed to fetch Codex usage status. Please try again shortly.');
  }
}
