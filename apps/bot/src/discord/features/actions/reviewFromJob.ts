import type { ButtonInteraction } from 'discord.js';
import type { Queue } from 'bullmq';
import { loadBotConfig } from '@sniptail/core/config/config.js';
import { logger } from '@sniptail/core/logger.js';
import { loadJobRecord, saveJobQueued } from '@sniptail/core/jobs/registry.js';
import { enqueueJob } from '@sniptail/core/queue/queue.js';
import type { JobSpec } from '@sniptail/core/types/job.js';
import { createJobId } from '../../../lib/jobs.js';

export async function handleReviewFromJobButton(
  interaction: ButtonInteraction,
  jobId: string,
  queue: Queue<JobSpec>,
) {
  const config = loadBotConfig();

  const record = await loadJobRecord(jobId).catch((err) => {
    logger.warn({ err, jobId }, 'Failed to load job record for review from job');
    return undefined;
  });

  const repoKeys = record?.job?.repoKeys ?? [];
  const gitRef = record?.job?.gitRef;
  if (!repoKeys.length || !gitRef) {
    await interaction.reply({
      content: `Unable to start a review for job ${jobId}.`,
      ephemeral: true,
    });
    return;
  }

  const channelId = interaction.channelId ?? interaction.user.id;
  const threadId = interaction.channel?.isThread()
    ? interaction.channelId
    : record?.job?.channel?.threadId;

  const job: JobSpec = {
    jobId: createJobId('review'),
    type: 'REVIEW',
    repoKeys,
    ...(repoKeys[0] && { primaryRepoKey: repoKeys[0] }),
    gitRef,
    requestText: `Review changes for job ${jobId}.`,
    agent: config.primaryAgent,
    channel: {
      provider: 'discord',
      channelId,
      userId: interaction.user.id,
      ...(threadId ? { threadId } : {}),
      ...(interaction.guildId ? { guildId: interaction.guildId } : {}),
    },
    resumeFromJobId: jobId,
    ...(record?.job?.threadContext ? { threadContext: record.job.threadContext } : {}),
  };

  try {
    await saveJobQueued(job);
  } catch (err) {
    logger.error({ err, jobId: job.jobId }, 'Failed to persist review job');
    await interaction.reply({
      content: `I couldn't persist review job ${job.jobId}. Please try again.`,
      ephemeral: true,
    });
    return;
  }

  await enqueueJob(queue, job);
  await interaction.reply({
    content: `Thanks! I've queued review job ${job.jobId}. I'll report back here.`,
    ephemeral: true,
  });
}
