import type { ChatInputCommandInteraction } from 'discord.js';
import type { QueuePublisher } from '@sniptail/core/queue/queueTransportTypes.js';
import { logger } from '@sniptail/core/logger.js';
import { enqueueWorkerEvent } from '@sniptail/core/queue/queue.js';
import type { WorkerEvent } from '@sniptail/core/types/worker-event.js';
import { WORKER_EVENT_SCHEMA_VERSION } from '@sniptail/core/types/worker-event.js';
import { authorizeDiscordOperationAndRespond } from '../../permissions/discordPermissionGuards.js';
import type { PermissionsRuntimeService } from '../../../permissions/permissionsRuntimeService.js';

export async function handleRepoRemoveAdmin(
  interaction: ChatInputCommandInteraction,
  workerEventQueue: QueuePublisher<WorkerEvent>,
  permissions: PermissionsRuntimeService,
) {
  const repoKey = interaction.options.getString('repo_key', true);
  await interaction.deferReply({ ephemeral: true });

  const event: WorkerEvent = {
    schemaVersion: WORKER_EVENT_SCHEMA_VERSION,
    type: 'repos.remove',
    payload: {
      response: {
        provider: 'discord',
        channelId: interaction.channelId,
        userId: interaction.user.id,
        ...(interaction.channel?.isThread() ? { threadId: interaction.channelId } : {}),
        ...(interaction.guildId ? { guildId: interaction.guildId } : {}),
      },
      repoKey,
    },
  };
  const authorized = await authorizeDiscordOperationAndRespond({
    permissions,
    action: 'repos.remove',
    summary: `Remove repo ${repoKey}`,
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
      await interaction.editReply('You are not authorized to remove repositories.');
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
    await interaction.editReply(`Queued repository removal for ${repoKey}.`);
  } catch (err) {
    logger.error({ err, repoKey }, 'Failed to queue repository removal');
    await interaction.editReply(`Failed to queue repository removal: ${(err as Error).message}`);
  }
}
