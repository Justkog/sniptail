import type { ModalSubmitInteraction } from 'discord.js';
import type { QueuePublisher } from '@sniptail/core/queue/queueTransportTypes.js';
import type { BotConfig } from '@sniptail/core/config/config.js';
import { saveJobQueued } from '@sniptail/core/jobs/registry.js';
import { logger } from '@sniptail/core/logger.js';
import { enqueueJob } from '@sniptail/core/queue/queue.js';
import { normalizeRunActionId } from '@sniptail/core/repos/runActions.js';
import type { JobSpec } from '@sniptail/core/types/job.js';
import { refreshRepoAllowlist } from '../../../lib/repoAllowlist.js';
import { resolveDefaultBaseBranch } from '../../../slack/modals.js';
import { createJobId } from '../../../lib/jobs.js';
import { runSelectionByUser } from '../../state.js';
import { buildInteractionChannelContext } from '../../lib/channel.js';
import { postDiscordJobAcceptance } from '../../lib/threads.js';
import { fetchDiscordThreadContext } from '../../threadContext.js';
import { authorizeDiscordOperationAndRespond } from '../../permissions/discordPermissionGuards.js';
import type { PermissionsRuntimeService } from '../../../permissions/permissionsRuntimeService.js';
import { computeAvailableRunActions } from '../../../lib/botRunActionAvailability.js';

export async function handleRunModalSubmit(
  interaction: ModalSubmitInteraction,
  config: BotConfig,
  queue: QueuePublisher<JobSpec>,
  permissions: PermissionsRuntimeService,
) {
  await refreshRepoAllowlist(config);

  const selection = runSelectionByUser.get(interaction.user.id);
  const repoKeys = selection?.repoKeys ?? [];
  if (!repoKeys.length) {
    await interaction.reply({
      content: 'Run selection expired. Please run the command again.',
      ephemeral: true,
    });
    return;
  }

  let actionId: string;
  try {
    actionId = normalizeRunActionId(selection?.actionId ?? '');
  } catch {
    await interaction.reply({
      content: 'Run action selection expired. Please run the command again.',
      ephemeral: true,
    });
    return;
  }

  const availableActions = computeAvailableRunActions(config, repoKeys);
  if (!availableActions.some((action) => action.id === actionId)) {
    await interaction.reply({
      content: 'Selected action is no longer available for these repositories.',
      ephemeral: true,
    });
    return;
  }

  await interaction.deferReply({ ephemeral: true });

  const gitRef = interaction.fields.getTextInputValue('git_ref').trim();
  const requestText = `Run action ${actionId}`;
  const threadContext = await fetchDiscordThreadContext(
    interaction.client,
    interaction.channelId!,
    undefined,
    true,
  );

  const job: JobSpec = {
    jobId: createJobId('run'),
    type: 'RUN',
    repoKeys,
    ...(repoKeys[0] ? { primaryRepoKey: repoKeys[0] } : {}),
    gitRef: gitRef || resolveDefaultBaseBranch(config.repoAllowlist, repoKeys[0]),
    requestText,
    run: { actionId },
    agent: config.primaryAgent,
    channel: buildInteractionChannelContext(interaction),
    ...(threadContext ? { threadContext } : {}),
  };

  const authorized = await authorizeDiscordOperationAndRespond({
    permissions,
    action: 'jobs.run',
    summary: `Queue run job ${job.jobId}`,
    operation: {
      kind: 'enqueueJob',
      job,
    },
    actor: {
      userId: interaction.user.id,
      channelId: job.channel.channelId,
      ...(job.channel.threadId ? { threadId: job.channel.threadId } : {}),
      ...(interaction.guildId ? { guildId: interaction.guildId } : {}),
      member: interaction.member,
    },
    client: interaction.client,
    onDeny: async () => {
      await interaction.editReply('You are not authorized to run custom actions.');
    },
    onRequireApprovalNotice: async (message) => {
      await interaction.editReply(message);
    },
  });
  if (!authorized) {
    return;
  }

  try {
    await saveJobQueued(job);
  } catch (err) {
    logger.error({ err, jobId: job.jobId }, 'Failed to persist run job');
    await interaction.editReply(`I couldn't persist job ${job.jobId}. Please try again.`);
    return;
  }

  await enqueueJob(queue, job);
  await postDiscordJobAcceptance(interaction, job, requestText, config.botName);
  runSelectionByUser.delete(interaction.user.id);
  await interaction.editReply(
    `Thanks! I've accepted run job ${job.jobId} (action: ${actionId}). I've posted a thread in this channel for updates.`,
  );
}
