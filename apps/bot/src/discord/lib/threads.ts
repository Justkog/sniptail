import type { ModalSubmitInteraction, Message } from 'discord.js';
import { logger } from '@sniptail/core/logger.js';
import type { JobSpec } from '@sniptail/core/types/job.js';
import { isSendableTextChannel, postDiscordMessage, type SendableTextChannel } from '../helpers.js';
import { truncateRequestSummary } from '../../lib/jobs.js';

export type DiscordJobAcceptanceResult = {
  acceptancePosted: boolean;
  requestMessageId?: string;
  channelId?: string;
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
  contextFiles?: JobSpec['contextFiles'],
): Promise<Message | undefined> {
  const requestSummary = truncateRequestSummary(requestText);
  try {
    return await postDiscordMessage(channel.client, {
      channelId: channel.id,
      channel,
      text: `**Job request: ${jobId}**\n\`\`\`\n${requestSummary}\n\`\`\``,
      ...(contextFiles?.length ? { contextFiles } : {}),
    });
  } catch (err) {
    logger.warn({ err, jobId }, 'Failed to post Discord job request');
    return undefined;
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
    const rootMessage = await postDiscordMessage(channel.client, {
      channelId: channel.id,
      channel,
      text: options?.requestAsPrimaryMessage
        ? `**Job request: ${job.jobId}**\n\`\`\`\n${truncateRequestSummary(requestText)}\n\`\`\``
        : (options?.acceptanceMessage ??
          `Thanks! I've accepted job ${job.jobId}. I'll report back here.`),
      ...(options?.requestAsPrimaryMessage && job.contextFiles?.length
        ? { contextFiles: job.contextFiles }
        : {}),
    });
    const threadTarget = await resolveDiscordThreadChannel(rootMessage, botName, job.jobId);
    const requestMessage = options?.requestAsPrimaryMessage
      ? rootMessage
      : await postDiscordJobRequest(threadTarget.channel, requestText, job.jobId, job.contextFiles);

    return {
      acceptancePosted: true,
      ...(requestMessage?.id ? { requestMessageId: requestMessage.id } : {}),
      ...(threadTarget.threadId ? { channelId: threadTarget.channel.id } : {}),
      ...(threadTarget.threadId ? { threadId: threadTarget.threadId } : {}),
    };
  } catch (err) {
    logger.warn({ err, jobId: job.jobId }, 'Failed to post Discord job acceptance');
    return { acceptancePosted: false };
  }
}
