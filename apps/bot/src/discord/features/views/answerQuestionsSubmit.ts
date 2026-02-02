import type { ModalSubmitInteraction } from 'discord.js';
import type { Queue } from 'bullmq';
import type { BotConfig } from '@sniptail/core/config/config.js';
import { loadJobRecord, saveJobQueued } from '@sniptail/core/jobs/registry.js';
import { logger } from '@sniptail/core/logger.js';
import { enqueueJob } from '@sniptail/core/queue/queue.js';
import type { JobSpec } from '@sniptail/core/types/job.js';
import { createJobId } from '../../../lib/jobs.js';
import { answerQuestionsByUser } from '../../state.js';
import { buildInteractionChannelContext } from '../../lib/channel.js';
import { postDiscordJobAcceptance } from '../../lib/threads.js';

export async function handleAnswerQuestionsSubmit(
  interaction: ModalSubmitInteraction,
  config: BotConfig,
  queue: Queue<JobSpec>,
) {
  const selection = answerQuestionsByUser.get(interaction.user.id);
  if (!selection) {
    await interaction.reply({
      content: 'Question session expired. Please click the button again.',
      ephemeral: true,
    });
    return;
  }

  const record = await loadJobRecord(selection.jobId).catch((err) => {
    logger.warn({ err, jobId: selection.jobId }, 'Failed to load job record for answer questions');
    return undefined;
  });

  if (!record) {
    await interaction.reply({
      content: `Unable to find job ${selection.jobId}. Please try again.`,
      ephemeral: true,
    });
    return;
  }

  await interaction.deferReply({ ephemeral: true });

  const answers = interaction.fields.getTextInputValue('answers').trim();
  const requestText = [record.job.requestText, `Follow-up answers:\n${answers}`].join('\n\n');

  const job: JobSpec = {
    jobId: createJobId('plan'),
    type: 'PLAN',
    repoKeys: record.job.repoKeys,
    ...(record.job.primaryRepoKey ? { primaryRepoKey: record.job.primaryRepoKey } : {}),
    gitRef: record.job.gitRef,
    requestText,
    agent: record.job.agent ?? config.primaryAgent,
    channel: buildInteractionChannelContext(interaction),
    resumeFromJobId: record.job.jobId,
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
  answerQuestionsByUser.delete(interaction.user.id);
  await interaction.editReply(
    `Thanks! I've accepted job ${job.jobId}. I've posted a thread in this channel for updates.`,
  );
}
