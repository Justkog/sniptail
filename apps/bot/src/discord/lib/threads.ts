import type { ModalSubmitInteraction, Message } from 'discord.js';
import { updateJobRecord } from '@sniptail/core/jobs/registry.js';
import { logger } from '@sniptail/core/logger.js';
import type { JobSpec } from '@sniptail/core/types/job.js';
import { isSendableTextChannel, type SendableTextChannel } from '../helpers.js';

async function resolveDiscordThreadChannel(
  message: Message,
  botName: string,
  jobId: string,
): Promise<{ channel: SendableTextChannel; threadId?: string }> {
  if (!isSendableTextChannel(message.channel)) {
    throw new Error('Discord channel is not sendable.');
  }
  if (message.channel.isThread()) {
    return { channel: message.channel, threadId: message.channel.id };
  }

  try {
    const threadName = `${botName} job ${jobId}`.slice(0, 100);
    const thread = await message.startThread({
      name: threadName,
      autoArchiveDuration: 1440,
    });
    return { channel: thread, threadId: thread.id };
  } catch (err) {
    logger.warn({ err, jobId }, 'Failed to create Discord thread for job');
    return { channel: message.channel };
  }
}

async function postDiscordJobRequest(
  channel: SendableTextChannel,
  requestText: string,
  jobId: string,
) {
  const requestSummary = requestText.trim() || 'No request text provided.';
  try {
    await channel.send(`**Job request**\n\`\`\`\n${requestSummary}\n\`\`\``);
  } catch (err) {
    logger.warn({ err, jobId }, 'Failed to post Discord job request');
  }
}

export async function postDiscordJobAcceptance(
  interaction: ModalSubmitInteraction,
  job: JobSpec,
  requestText: string,
  botName: string,
): Promise<string | undefined> {
  const channel = interaction.channel;
  if (!channel || !channel.isTextBased() || !isSendableTextChannel(channel)) {
    return undefined;
  }

  try {
    const acceptedMessage = await channel.send(
      `Thanks! I've accepted job ${job.jobId}. I'll report back here.`,
    );
    const threadTarget = await resolveDiscordThreadChannel(acceptedMessage, botName, job.jobId);
    await postDiscordJobRequest(threadTarget.channel, requestText, job.jobId);

    if (threadTarget.threadId) {
      await updateJobRecord(job.jobId, {
        job: {
          ...job,
          channel: {
            ...job.channel,
            threadId: threadTarget.threadId,
          },
        },
      }).catch((err) => {
        logger.warn({ err, jobId: job.jobId }, 'Failed to record Discord thread id');
      });
    }

    return threadTarget.threadId;
  } catch (err) {
    logger.warn({ err, jobId: job.jobId }, 'Failed to post Discord job acceptance');
    return undefined;
  }
}
