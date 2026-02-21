import type { ChatInputCommandInteraction } from 'discord.js';
import type { QueuePublisher } from '@sniptail/core/queue/queueTransportTypes.js';
import { logger } from '@sniptail/core/logger.js';
import { enqueueWorkerEvent } from '@sniptail/core/queue/queue.js';
import type { WorkerEvent } from '@sniptail/core/types/worker-event.js';
import { WORKER_EVENT_SCHEMA_VERSION } from '@sniptail/core/types/worker-event.js';
import { parseCutoffDateInput } from '../../../slack/lib/parsing.js';
import { authorizeDiscordOperationAndRespond } from '../../permissions/discordPermissionGuards.js';
import type { PermissionsRuntimeService } from '../../../permissions/permissionsRuntimeService.js';

export async function handleClearBefore(
  interaction: ChatInputCommandInteraction,
  workerEventQueue: QueuePublisher<WorkerEvent>,
  permissions: PermissionsRuntimeService,
) {
  const cutoffInput = interaction.options.getString('cutoff', true);
  const cutoff = parseCutoffDateInput(cutoffInput);
  if (!cutoff) {
    await interaction.reply({
      content: 'Usage: provide a valid cutoff date (YYYY-MM-DD or ISO timestamp).',
      ephemeral: true,
    });
    return;
  }

  await interaction.deferReply({ ephemeral: true });

  const event: WorkerEvent = {
    schemaVersion: WORKER_EVENT_SCHEMA_VERSION,
    type: 'jobs.clearBefore',
    payload: {
      cutoffIso: cutoff.toISOString(),
    },
  };
  const authorized = await authorizeDiscordOperationAndRespond({
    permissions,
    action: 'jobs.clearBefore',
    summary: `Clear jobs created before ${cutoff.toISOString()}`,
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
      await interaction.editReply('You are not authorized to clear jobs.');
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
    await interaction.editReply(`Clearing jobs created before ${cutoff.toISOString()}...`);
  } catch (err) {
    logger.error({ err, cutoff: cutoff.toISOString() }, 'Failed to clear jobs before cutoff');
    await interaction.editReply(`Failed to clear jobs before ${cutoff.toISOString()}.`);
  }
}
