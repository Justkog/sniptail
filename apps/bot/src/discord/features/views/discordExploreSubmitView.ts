import type { ModalSubmitInteraction } from 'discord.js';
import type { QueuePublisher } from '@sniptail/core/queue/queueTransportTypes.js';
import type { BotConfig } from '@sniptail/core/config/config.js';
import { saveJobQueued } from '@sniptail/core/jobs/registry.js';
import { logger } from '@sniptail/core/logger.js';
import { enqueueJob } from '@sniptail/core/queue/queue.js';
import type { JobSpec } from '@sniptail/core/types/job.js';
import { refreshRepoAllowlist } from '../../../lib/repoAllowlist.js';
import { resolveDefaultBaseBranch } from '../../../slack/modals.js';
import { createJobId } from '../../../lib/jobs.js';
import { exploreSelectionByUser } from '../../state.js';
import { buildInteractionChannelContext } from '../../lib/channel.js';
import { postDiscordJobAcceptance } from '../../lib/threads.js';
import { fetchDiscordThreadContext } from '../../threadContext.js';
import { authorizeDiscordOperationAndRespond } from '../../permissions/discordPermissionGuards.js';
import type { PermissionsRuntimeService } from '../../../permissions/permissionsRuntimeService.js';

export async function handleDiscordExploreModalSubmit(
  interaction: ModalSubmitInteraction,
  config: BotConfig,
  queue: QueuePublisher<JobSpec>,
  permissions: PermissionsRuntimeService,
) {
  await refreshRepoAllowlist(config);

  const selection = exploreSelectionByUser.get(interaction.user.id);
  const repoKeys = selection?.repoKeys ?? [];
  if (!repoKeys.length) {
    await interaction.reply({
      content: 'Repository selection expired. Please run the explore command again.',
      ephemeral: true,
    });
    return;
  }

  const unknownRepos = repoKeys.filter((key) => !config.repoAllowlist[key]);
  if (unknownRepos.length) {
    await interaction.reply({
      content: `Unknown repo keys: ${unknownRepos.join(', ')}. Update the allowlist and try again.`,
      ephemeral: true,
    });
    return;
  }

  await interaction.deferReply({ ephemeral: true });

  const gitRef = interaction.fields.getTextInputValue('git_ref').trim();
  const requestText = interaction.fields.getTextInputValue('question').trim();
  const resumeFromInput = interaction.fields.getTextInputValue('resume_from').trim();
  const resumeFromJobId = resumeFromInput || undefined;
  const threadContext = await fetchDiscordThreadContext(
    interaction.client,
    interaction.channelId!,
    undefined,
    true,
  );

  const job: JobSpec = {
    jobId: createJobId('explore'),
    type: 'EXPLORE',
    repoKeys,
    ...(repoKeys[0] && { primaryRepoKey: repoKeys[0] }),
    gitRef: gitRef || resolveDefaultBaseBranch(config.repoAllowlist, repoKeys[0]),
    requestText,
    agent: config.primaryAgent,
    channel: buildInteractionChannelContext(interaction),
    ...(threadContext ? { threadContext } : {}),
    ...(resumeFromJobId ? { resumeFromJobId } : {}),
  };

  const authorized = await authorizeDiscordOperationAndRespond({
    permissions,
    action: 'jobs.explore',
    summary: `Queue explore job ${job.jobId}`,
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
      await interaction.editReply('You are not authorized to run explore jobs.');
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
    logger.error({ err, jobId: job.jobId }, 'Failed to persist job');
    await interaction.editReply(`I couldn't persist job ${job.jobId}. Please try again.`);
    return;
  }

  await enqueueJob(queue, job);
  await postDiscordJobAcceptance(interaction, job, requestText, config.botName);
  exploreSelectionByUser.delete(interaction.user.id);
  await interaction.editReply(
    `Thanks! I've accepted job ${job.jobId}. I've posted a thread in this channel for updates.`,
  );
}
