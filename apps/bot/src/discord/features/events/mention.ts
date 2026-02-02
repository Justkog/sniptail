import type { Message } from 'discord.js';
import type { Queue } from 'bullmq';
import type { BotConfig } from '@sniptail/core/config/config.js';
import { saveJobQueued } from '@sniptail/core/jobs/registry.js';
import { logger } from '@sniptail/core/logger.js';
import { enqueueJob } from '@sniptail/core/queue/queue.js';
import type { JobSpec } from '@sniptail/core/types/job.js';
import { createJobId } from '../../../lib/jobs.js';
import { fetchDiscordThreadContext, stripDiscordMentions } from '../../threadContext.js';
import { buildChannelContext } from '../../lib/channel.js';
import { dedupe } from '../../../slack/lib/dedupe.js';

const defaultGitRef = 'main';

export async function handleMention(message: Message, config: BotConfig, queue: Queue<JobSpec>) {
  if (!message.mentions.has(message.client.user)) {
    return;
  }

  const dedupeKey = `${message.channelId}:${message.id}:mention`;
  if (dedupe(dedupeKey)) return;

  try {
    await message.react('👀');
  } catch (err) {
    logger.warn({ err, messageId: message.id }, 'Failed to add Discord mention reaction');
  }

  const threadContext = await fetchDiscordThreadContext(
    message.client,
    message.channelId,
    message.id,
  );
  const strippedText = stripDiscordMentions(message.content);
  const requestText =
    strippedText ||
    (threadContext ? 'Please answer based on the thread history.' : '') ||
    'Say hello and ask how you can help.';

  const job: JobSpec = {
    jobId: createJobId('mention'),
    type: 'MENTION',
    repoKeys: [],
    gitRef: defaultGitRef,
    requestText,
    agent: config.primaryAgent,
    channel: buildChannelContext(message),
    ...(threadContext ? { threadContext } : {}),
  };

  try {
    await saveJobQueued(job);
  } catch (err) {
    logger.error({ err, jobId: job.jobId }, 'Failed to persist mention job');
    await message.reply('I could not start that request. Please try again.');
    return;
  }

  await enqueueJob(queue, job);
}
