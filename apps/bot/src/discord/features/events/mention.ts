import { MessageType, type Message } from 'discord.js';
import type { QueuePublisher } from '@sniptail/core/queue/queueTransportTypes.js';
import type { BotConfig } from '@sniptail/core/config/config.js';
import { saveJobQueued } from '@sniptail/core/jobs/registry.js';
import { logger } from '@sniptail/core/logger.js';
import { enqueueJob } from '@sniptail/core/queue/queue.js';
import type { JobSpec } from '@sniptail/core/types/job.js';
import { toSlackCommandPrefix } from '@sniptail/core/utils/slack.js';
import { createJobId } from '../../../lib/jobs.js';
import { resolveDefaultBaseBranch } from '../../../lib/repoBaseBranch.js';
import { fetchDiscordThreadContext, stripDiscordMentions } from '../../threadContext.js';
import { buildChannelContext } from '../../lib/channel.js';
import { dedupe } from '../../../slack/lib/dedupe.js';
import { refreshRepoAllowlist } from '../../../lib/repoAllowlist.js';
import { authorizeDiscordOperationAndRespond } from '../../permissions/discordPermissionGuards.js';
import type { PermissionsRuntimeService } from '../../../permissions/permissionsRuntimeService.js';
import {
  getDiscordMessageContextAttachments,
  loadDiscordContextFiles,
} from '../../lib/discordContextFiles.js';

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
  queue: QueuePublisher<JobSpec>,
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
  const gitRef = resolveDefaultBaseBranch(config.repoAllowlist);

  const baseJob: JobSpec = {
    jobId: createJobId('mention'),
    type: 'MENTION',
    repoKeys: [],
    gitRef,
    requestText,
    agent: config.primaryAgent,
    channel: buildChannelContext(message),
    ...(threadContext ? { threadContext } : {}),
  };

  const authorized = await authorizeDiscordOperationAndRespond({
    permissions,
    botName: config.botName,
    action: 'jobs.mention',
    summary: `Queue mention job ${baseJob.jobId}`,
    operation: {
      kind: 'enqueueJob',
      job: baseJob,
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
    approvalPresentation: 'approval_only',
    resolveApprovalThreadId: async (approvalId) => {
      if (message.channel.isThread()) {
        return message.channelId;
      }
      const threadName = `${toSlackCommandPrefix(config.botName)} approval ${approvalId}`.slice(
        0,
        100,
      );
      try {
        const thread = await message.startThread({
          name: threadName,
          autoArchiveDuration: 1440,
        });
        return thread.id;
      } catch (err) {
        logger.warn(
          { err, approvalId, messageId: message.id, channelId: message.channelId },
          'Failed to create Discord approval thread from mention message',
        );
        return undefined;
      }
    },
  });
  if (!authorized) {
    return;
  }

  const attachments = getDiscordMessageContextAttachments(message);
  let contextFiles = undefined;
  if (attachments.length) {
    try {
      const loadedFiles = await loadDiscordContextFiles(attachments);
      contextFiles = loadedFiles.length ? loadedFiles : undefined;
    } catch (err) {
      logger.warn({ err, messageId: message.id }, 'Failed to load Discord mention context files');
      await message.reply(`I couldn't use the attached files: ${(err as Error).message}`);
      return;
    }
  }

  const job: JobSpec = {
    ...baseJob,
    ...(contextFiles ? { contextFiles } : {}),
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
