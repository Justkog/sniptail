import type { ChatInputCommandInteraction } from 'discord.js';
import type { QueuePublisher } from '@sniptail/core/queue/queueTransportTypes.js';
import { logger } from '@sniptail/core/logger.js';
import { enqueueWorkerEvent } from '@sniptail/core/queue/queue.js';
import {
  WORKER_EVENT_SCHEMA_VERSION,
  type WorkerEvent,
} from '@sniptail/core/types/worker-event.js';
import { authorizeDiscordOperationAndRespond } from '../../permissions/discordPermissionGuards.js';
import type { PermissionsRuntimeService } from '../../../permissions/permissionsRuntimeService.js';

export async function handleRepoAddAdmin(
  interaction: ChatInputCommandInteraction,
  workerEventQueue: QueuePublisher<WorkerEvent>,
  permissions: PermissionsRuntimeService,
) {
  const rawRepoKey = interaction.options.getString('repo_key', true);
  const repoKey = rawRepoKey.trim();
  if (!repoKey) {
    await interaction.reply({
      content: 'Repository key cannot be empty or only whitespace.',
      ephemeral: true,
    });
    return;
  }
  const repoProvider = interaction.options.getString('provider', true);
  const sshUrl = interaction.options.getString('ssh_url') ?? undefined;
  const localPath = interaction.options.getString('local_path') ?? undefined;
  const projectId = interaction.options.getInteger('project_id') ?? undefined;
  const baseBranch = interaction.options.getString('base_branch') ?? undefined;

  if (repoProvider === 'local' && !localPath) {
    await interaction.reply({
      content: 'Local repositories require `local_path`.',
      ephemeral: true,
    });
    return;
  }
  if (repoProvider !== 'local' && !sshUrl) {
    await interaction.reply({
      content: 'Remote repositories require `ssh_url`.',
      ephemeral: true,
    });
    return;
  }
  if (sshUrl && localPath) {
    await interaction.reply({
      content: 'Provide either `ssh_url` or `local_path`, not both.',
      ephemeral: true,
    });
    return;
  }
  if (repoProvider === 'gitlab' && projectId === undefined) {
    await interaction.reply({
      content: 'GitLab repositories require `project_id`.',
      ephemeral: true,
    });
    return;
  }

  await interaction.deferReply({ ephemeral: true });

  const event: WorkerEvent = {
    schemaVersion: WORKER_EVENT_SCHEMA_VERSION,
    type: 'repos.add',
    payload: {
      response: {
        provider: 'discord',
        channelId: interaction.channelId,
        userId: interaction.user.id,
        ...(interaction.channel?.isThread() ? { threadId: interaction.channelId } : {}),
        ...(interaction.guildId ? { guildId: interaction.guildId } : {}),
      },
      repoKey,
      repoProvider,
      ...(sshUrl ? { sshUrl } : {}),
      ...(localPath ? { localPath } : {}),
      ...(projectId !== undefined ? { projectId } : {}),
      ...(baseBranch ? { baseBranch } : {}),
    },
  };
  const authorized = await authorizeDiscordOperationAndRespond({
    permissions,
    action: 'repos.add',
    summary: `Add repo ${repoKey} (provider: ${repoProvider})`,
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
      await interaction.editReply('You are not authorized to add repositories.');
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
    await interaction.editReply(`Queued repository add for ${repoKey}.`);
  } catch (err) {
    logger.error({ err, repoKey, repoProvider }, 'Failed to queue repository add');
    await interaction.editReply(`Failed to queue repository add: ${(err as Error).message}`);
  }
}
