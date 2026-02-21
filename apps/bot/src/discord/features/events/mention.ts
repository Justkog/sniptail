import { MessageType, type Message } from 'discord.js';
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
import { refreshRepoAllowlist } from '../../../lib/repoAllowlist.js';
import { authorizeDiscordOperationAndRespond } from '../../permissions/discordPermissionGuards.js';
import type { PermissionsRuntimeService } from '../../../permissions/permissionsRuntimeService.js';

const defaultGitRef = 'main';

async function isReplyToBot(message: Message): Promise<boolean> {
  if (message.type !== MessageType.Reply || !message.reference?.messageId) {
    return false;
  }

  if (message.mentions.repliedUser?.id === message.client.user.id) {
    return true;
  }

  const cachedReferenced = message.channel.messages.cache.get(message.reference.messageId);
  if (cachedReferenced) {
    return cachedReferenced.author.id === message.client.user.id;
  }

  try {
    const referenced = await message.fetchReference();
    return referenced.author.id === message.client.user.id;
  } catch (err) {
    logger.debug(
      {
        err,
        messageId: message.id,
        referencedMessageId: message.reference?.messageId,
        channelId: message.channelId,
        guildId: message.guildId,
      },
      'Failed to fetch referenced message',
    );
    return false;
  }
}

export async function handleMention(
  message: Message,
  config: BotConfig,
  queue: Queue<JobSpec>,
  permissions: PermissionsRuntimeService,
) {
  const isMention = message.mentions.has(message.client.user);
  const isReply = isMention ? false : await isReplyToBot(message);

  if (!isMention && !isReply) {
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
  await refreshRepoAllowlist(config);
  const repoKeys = Object.keys(config.repoAllowlist);

  const job: JobSpec = {
    jobId: createJobId('mention'),
    type: 'MENTION',
    repoKeys,
    gitRef: defaultGitRef,
    requestText,
    agent: config.primaryAgent,
    channel: buildChannelContext(message),
    ...(threadContext ? { threadContext } : {}),
  };

  const authorized = await authorizeDiscordOperationAndRespond({
    permissions,
    action: 'jobs.mention',
    summary: `Queue mention job ${job.jobId}`,
    operation: {
      kind: 'enqueueJob',
      job,
    },
    actor: {
      userId: message.author.id,
      channelId: message.channelId,
      ...(message.channel.isThread() ? { threadId: message.channelId } : {}),
      ...(message.guildId ? { guildId: message.guildId } : {}),
      member: message.member,
    },
    client: message.client,
    onDeny: async () => {
      await message.reply('You are not authorized to trigger mention jobs.');
    },
    onRequireApprovalNotice: async (text) => {
      await message.reply(text);
    },
  });
  if (!authorized) {
    return;
  }

  try {
    await saveJobQueued(job);
  } catch (err) {
    logger.error({ err, jobId: job.jobId }, 'Failed to persist mention job');
    await message.reply('I could not start that request. Please try again.');
    return;
  }

  await enqueueJob(queue, job);
}
