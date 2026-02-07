import type { ModalSubmitInteraction } from 'discord.js';
import type { Queue } from 'bullmq';
import type { BotConfig } from '@sniptail/core/config/config.js';
import { saveJobQueued } from '@sniptail/core/jobs/registry.js';
import { logger } from '@sniptail/core/logger.js';
import { enqueueJob } from '@sniptail/core/queue/queue.js';
import type { JobSpec } from '@sniptail/core/types/job.js';
import { refreshRepoAllowlist } from '../../../slack/lib/repoAllowlist.js';
import { resolveDefaultBaseBranch } from '../../../slack/modals.js';
import { createJobId } from '../../../lib/jobs.js';
import { implementSelectionByUser } from '../../state.js';
import { buildInteractionChannelContext } from '../../lib/channel.js';
import { postDiscordJobAcceptance } from '../../lib/threads.js';
import { parseCommaList } from '../../../slack/lib/parsing.js';
import { fetchDiscordThreadContext } from '../../threadContext.js';

export async function handleImplementModalSubmit(
  interaction: ModalSubmitInteraction,
  config: BotConfig,
  queue: Queue<JobSpec>,
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
    ...(threadContext ? { threadContext } : {}),
    ...(resumeFromJobId ? { resumeFromJobId } : {}),
  };

  if (reviewers || labels) {
    job.settings = {
      ...(reviewers ? { reviewers } : {}),
      ...(labels ? { labels } : {}),
    };
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
  implementSelectionByUser.delete(interaction.user.id);
  await interaction.editReply(
    `Thanks! I've accepted job ${job.jobId}. I've posted a thread in this channel for updates.`,
  );
}
