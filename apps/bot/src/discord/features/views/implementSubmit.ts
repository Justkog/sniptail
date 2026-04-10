import type { ModalSubmitInteraction } from 'discord.js';
import type { QueuePublisher } from '@sniptail/core/queue/queueTransportTypes.js';
import type { BotConfig } from '@sniptail/core/config/config.js';
import { saveJobQueued } from '@sniptail/core/jobs/registry.js';
import { logger } from '@sniptail/core/logger.js';
import { enqueueJob } from '@sniptail/core/queue/queue.js';
import type { JobSpec } from '@sniptail/core/types/job.js';
import { refreshRepoAllowlist } from '../../../lib/repoAllowlist.js';
import { createJobId } from '../../../lib/jobs.js';
import { resolveDefaultBaseBranch } from '../../../lib/repoBaseBranch.js';
import { implementSelectionByUser } from '../../state.js';
import { buildInteractionChannelContext } from '../../lib/channel.js';
import { postDiscordJobAcceptance } from '../../lib/threads.js';
import { loadDiscordContextFiles } from '../../lib/discordContextFiles.js';
import { parseCommaList } from '../../../slack/lib/parsing.js';
import { fetchDiscordThreadContext } from '../../threadContext.js';
import { authorizeDiscordOperationAndRespond } from '../../permissions/discordPermissionGuards.js';
import type { PermissionsRuntimeService } from '../../../permissions/permissionsRuntimeService.js';

export async function handleImplementModalSubmit(
  interaction: ModalSubmitInteraction,
  config: BotConfig,
  queue: QueuePublisher<JobSpec>,
  permissions: PermissionsRuntimeService,
) {
  await refreshRepoAllowlist(config);

  const selection = implementSelectionByUser.get(interaction.user.id);
  const repoKeys = selection?.repoKeys ?? [];
  if (!repoKeys.length) {
    await interaction.reply({
      content: 'Repository selection expired. Please run the implement command again.',
      ephemeral: true,
    });
    return;
  }

  await interaction.deferReply({ ephemeral: true });

  let contextFiles;
  try {
    const uploadedFiles = await loadDiscordContextFiles(selection?.contextAttachments ?? []);
    contextFiles = uploadedFiles.length ? uploadedFiles : undefined;
  } catch (err) {
    logger.warn({ err }, 'Failed to load Discord command context files for implement job');
    await interaction.editReply(`I couldn't use the attached files: ${(err as Error).message}`);
    return;
  }

  const gitRef = interaction.fields.getTextInputValue('git_ref').trim();
  const requestText = interaction.fields.getTextInputValue('request_text').trim();
  const reviewersInput = interaction.fields.getTextInputValue('reviewers').trim();
  const labelsInput = interaction.fields.getTextInputValue('labels').trim();
  const resumeFromInput = interaction.fields.getTextInputValue('resume_from').trim();

  const reviewers = reviewersInput ? parseCommaList(reviewersInput) : undefined;
  const labels = labelsInput ? parseCommaList(labelsInput) : undefined;
  const resumeFromJobId = resumeFromInput || undefined;
  const threadContext = await fetchDiscordThreadContext(
    interaction.client,
    interaction.channelId!,
    undefined,
    true,
  );

  const job: JobSpec = {
    jobId: createJobId('implement'),
    type: 'IMPLEMENT',
    repoKeys,
    ...(repoKeys[0] && { primaryRepoKey: repoKeys[0] }),
    gitRef: gitRef || resolveDefaultBaseBranch(config.repoAllowlist, repoKeys[0]),
    requestText,
    agent: config.primaryAgent,
    channel: buildInteractionChannelContext(interaction),
    ...(contextFiles ? { contextFiles } : {}),
    ...(threadContext ? { threadContext } : {}),
    ...(resumeFromJobId ? { resumeFromJobId } : {}),
  };

  if (reviewers || labels) {
    job.settings = {
      ...(reviewers ? { reviewers } : {}),
      ...(labels ? { labels } : {}),
    };
  }

  const authorized = await authorizeDiscordOperationAndRespond({
    permissions,
    botName: config.botName,
    action: 'jobs.implement',
    summary: `Queue implement job ${job.jobId}`,
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
      await interaction.editReply('You are not authorized to run implement jobs.');
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
  const acceptance = await postDiscordJobAcceptance(interaction, job, requestText, config.botName, {
    requestAsPrimaryMessage: true,
  });
  implementSelectionByUser.delete(interaction.user.id);
  if (acceptance.acceptancePosted) {
    try {
      await interaction.deleteReply();
    } catch (err) {
      logger.warn({ err, jobId: job.jobId }, 'Failed to delete ephemeral interaction reply');
    }
    return;
  }
  await interaction.editReply(`Thanks! I've accepted job ${job.jobId}.`);
}
