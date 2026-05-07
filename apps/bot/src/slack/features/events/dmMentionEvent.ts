import { logger } from '@sniptail/core/logger.js';
import type { SlackHandlerContext } from '../context.js';
import { addReaction } from '../../helpers.js';
import { resolveSlackRuntimeIdentity } from '../../lib/slackRuntimeIdentity.js';
import { handleSlackAgentThreadMessage } from './agentThreadMention.js';
import { queueSlackMentionJob } from './slackMentionEventRouting.js';

type SlackMessageEvent = {
  channel?: string;
  text?: string;
  thread_ts?: string;
  ts?: string;
  files?: Array<{ id?: string }>;
  bot_id?: string;
  user?: string;
  subtype?: string;
  channel_type?: string;
};

function isDirectMessageChannel(channelType?: string): channelType is 'im' | 'mpim' {
  return channelType === 'im' || channelType === 'mpim';
}

function isChannelThreadReply(channelType?: string, threadTs?: string, ts?: string): boolean {
  return (channelType === 'channel' || channelType === 'group') && Boolean(threadTs && ts);
}

function includesExplicitMention(text: string, botUserId: string): boolean {
  return text.includes(`<@${botUserId}>`);
}

export function registerDmMentionEvent({
  app,
  config,
  queue,
  workerEventQueue,
  permissions,
  slackIds,
}: SlackHandlerContext) {
  app.event('message', async ({ event, client }) => {
    const message = event as SlackMessageEvent;
    const channelId = message.channel;
    const text = message.text ?? '';
    const threadId = message.thread_ts ?? message.ts;
    const eventTs = message.ts;
    const botId = message.bot_id;
    const userId = message.user;
    const messageFiles = message.files;
    const subtype = message.subtype;
    const channelType = message.channel_type;

    if (!channelId || !threadId || !eventTs || !userId || !text || botId || subtype) {
      return;
    }

    if (isChannelThreadReply(channelType, message.thread_ts, eventTs)) {
      await handleSlackAgentThreadMessage(
        {
          app,
          config,
          workerEventQueue,
          permissions,
          slackIds,
        },
        {
          channelId,
          text,
          threadId,
          eventTs,
          userId,
          ...((event as { team?: string }).team
            ? { workspaceId: (event as { team?: string }).team }
            : {}),
        },
      );
      return;
    }

    if (!isDirectMessageChannel(channelType)) {
      return;
    }

    let botUserId: string | undefined;
    try {
      const identity = await resolveSlackRuntimeIdentity(app);
      botUserId = identity.botUserId;
    } catch {
      return;
    }
    if (!botUserId || !includesExplicitMention(text, botUserId)) {
      return;
    }

    await addReaction(app, {
      channel: channelId,
      name: 'eyes',
      messageId: eventTs,
    });

    logger.info(
      { channelId, threadId, subtype, channelType, text },
      'Received Slack DM mention event',
    );

    const handledAgentMention = await handleSlackAgentThreadMessage(
      {
        app,
        config,
        workerEventQueue,
        permissions,
        slackIds,
      },
      {
        channelId,
        text,
        threadId,
        ...(eventTs ? { eventTs } : {}),
        ...(userId ? { userId } : {}),
      },
    );
    if (handledAgentMention) {
      return;
    }

    await queueSlackMentionJob(
      {
        app,
        config,
        queue,
        permissions,
        slackIds,
      },
      client,
      {
        channelId,
        text,
        threadId,
        ...(messageFiles?.length ? { messageFiles } : {}),
        dedupeMode: 'dm-mention',
        onDenyText: 'You are not authorized to mention this bot in DMs for jobs.',
        ...(eventTs ? { eventTs } : {}),
        ...(userId ? { userId } : {}),
      },
    );
  });
}
