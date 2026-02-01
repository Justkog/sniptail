import type { ModalSubmitInteraction } from 'discord.js';
import type { Queue } from 'bullmq';
import { loadBotConfig } from '@sniptail/core/config/config.js';
import { saveJobQueued } from '@sniptail/core/jobs/registry.js';
import { logger } from '@sniptail/core/logger.js';
import { enqueueJob } from '@sniptail/core/queue/queue.js';
import type { JobSpec } from '@sniptail/core/types/job.js';
import { refreshRepoAllowlist } from '../../../slack/lib/repoAllowlist.js';
import { resolveDefaultBaseBranch } from '../../../slack/modals.js';
import { createJobId } from '../../../lib/jobs.js';
import { planSelectionByUser } from '../../state.js';
import { buildInteractionChannelContext } from '../../lib/channel.js';
import { postDiscordJobAcceptance } from '../../lib/threads.js';
import { fetchDiscordThreadContext } from '../../threadContext.js';

export async function handlePlanModalSubmit(
  interaction: ModalSubmitInteraction,
  queue: Queue<JobSpec>,
) {
  const config = loadBotConfig();
  refreshRepoAllowlist(config);

  const selection = planSelectionByUser.get(interaction.user.id);
  const repoKeys = selection?.repoKeys ?? [];
  if (!repoKeys.length) {
    await interaction.reply({
      content: 'Repository selection expired. Please run the plan command again.',
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
    jobId: createJobId('plan'),
    type: 'PLAN',
    repoKeys,
    ...(repoKeys[0] && { primaryRepoKey: repoKeys[0] }),
    gitRef: gitRef || resolveDefaultBaseBranch(config.repoAllowlist, repoKeys[0]),
    requestText,
    agent: config.primaryAgent,
    channel: buildInteractionChannelContext(interaction),
    ...(threadContext ? { threadContext } : {}),
    ...(resumeFromJobId ? { resumeFromJobId } : {}),
  };

  try {
    await saveJobQueued(job);
  } catch (err) {
    logger.error({ err, jobId: job.jobId }, 'Failed to persist job');
    await interaction.editReply(`I couldn't persist job ${job.jobId}. Please try again.`);
    return;
  }

  await enqueueJob(queue, job);
  await postDiscordJobAcceptance(interaction, job, requestText, config.botName);
  planSelectionByUser.delete(interaction.user.id);
  await interaction.editReply(
    `Thanks! I've accepted job ${job.jobId}. I've posted a thread in this channel for updates.`,
  );
}
