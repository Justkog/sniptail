import type { ModalSubmitInteraction } from 'discord.js';
import type { QueuePublisher } from '@sniptail/core/queue/queueTransportTypes.js';
import type { BotConfig } from '@sniptail/core/config/config.js';
import { loadJobRecord, saveJobQueued } from '@sniptail/core/jobs/registry.js';
import { logger } from '@sniptail/core/logger.js';
import { enqueueJob } from '@sniptail/core/queue/queue.js';
import type { JobSpec } from '@sniptail/core/types/job.js';
import { createJobId } from '../../../lib/jobs.js';
import { answerQuestionsByUser } from '../../state.js';
import { buildInteractionChannelContext } from '../../lib/channel.js';
import { postDiscordJobAcceptance } from '../../lib/threads.js';
import { authorizeDiscordOperationAndRespond } from '../../permissions/discordPermissionGuards.js';
import type { PermissionsRuntimeService } from '../../../permissions/permissionsRuntimeService.js';

export async function handleAnswerQuestionsSubmit(
  interaction: ModalSubmitInteraction,
  config: BotConfig,
  queue: QueuePublisher<JobSpec>,
  permissions: PermissionsRuntimeService,
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

  const authorized = await authorizeDiscordOperationAndRespond({
    permissions,
    action: 'jobs.answerQuestions',
    summary: `Queue answer-questions job ${job.jobId}`,
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
      await interaction.editReply('You are not authorized to submit answers for this job.');
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
  answerQuestionsByUser.delete(interaction.user.id);
  await interaction.editReply(
    `Thanks! I've accepted job ${job.jobId}. I've posted a thread in this channel for updates.`,
  );
}
