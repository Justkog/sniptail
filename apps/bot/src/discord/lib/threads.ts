import type { ModalSubmitInteraction, Message } from 'discord.js';
import { updateJobRecord } from '@sniptail/core/jobs/registry.js';
import { logger } from '@sniptail/core/logger.js';
import type { JobSpec } from '@sniptail/core/types/job.js';
import { isSendableTextChannel, type SendableTextChannel } from '../helpers.js';
import { truncateRequestSummary } from '../../lib/jobs.js';

export type DiscordJobAcceptanceResult = {
  acceptancePosted: boolean;
  threadId?: string;
};

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
  const requestSummary = truncateRequestSummary(requestText);
  try {
    await channel.send(`**Job request: ${jobId}**\n\`\`\`\n${requestSummary}\n\`\`\``);
  } catch (err) {
    logger.warn({ err, jobId }, 'Failed to post Discord job request');
  }
}

export async function postDiscordJobAcceptance(
  interaction: ModalSubmitInteraction,
  job: JobSpec,
  requestText: string,
  botName: string,
  options?: {
    requestAsPrimaryMessage?: boolean;
    acceptanceMessage?: string;
  },
): Promise<DiscordJobAcceptanceResult> {
  const channel = interaction.channel;
  if (!channel || !channel.isTextBased() || !isSendableTextChannel(channel)) {
    return { acceptancePosted: false };
  }

  try {
    const rootMessage = await channel.send(
      options?.requestAsPrimaryMessage
        ? `**Job request: ${job.jobId}**\n\`\`\`\n${truncateRequestSummary(requestText)}\n\`\`\``
        : (options?.acceptanceMessage ??
          `Thanks! I've accepted job ${job.jobId}. I'll report back here.`),
    );
    const threadTarget = await resolveDiscordThreadChannel(rootMessage, botName, job.jobId);
    if (!options?.requestAsPrimaryMessage) {
      await postDiscordJobRequest(threadTarget.channel, requestText, job.jobId);
    }

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

    return {
      acceptancePosted: true,
      ...(threadTarget.threadId ? { threadId: threadTarget.threadId } : {}),
    };
  } catch (err) {
    logger.warn({ err, jobId: job.jobId }, 'Failed to post Discord job acceptance');
    return { acceptancePosted: false };
  }
}
