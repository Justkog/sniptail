import { logger } from '@sniptail/core/logger.js';
import type { SlackHandlerContext } from '../context.js';
import { resolveSlackRuntimeIdentity } from '../../lib/slackRuntimeIdentity.js';
import { queueSlackMentionJob } from './slackMentionEventRouting.js';

type SlackMessageEvent = {
  channel?: string;
  text?: string;
  thread_ts?: string;
  ts?: string;
  bot_id?: string;
  user?: string;
  subtype?: string;
  channel_type?: string;
};

function isDirectMessageChannel(channelType?: string): channelType is 'im' | 'mpim' {
  return channelType === 'im' || channelType === 'mpim';
}

function includesExplicitMention(text: string, botUserId: string): boolean {
  return text.includes(`<@${botUserId}>`);
}

export function registerDmMentionEvent({
  app,
  config,
  queue,
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
    const subtype = message.subtype;
    const channelType = message.channel_type;

    logger.info(
      { channelId, threadId, botId, subtype, channelType, text },
      'Received Slack message event',
    );

    if (
      !channelId ||
      !threadId ||
      !eventTs ||
      !userId ||
      !text ||
      botId ||
      subtype ||
      !isDirectMessageChannel(channelType)
    ) {
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
        dedupeMode: 'dm-mention',
        onDenyText: 'You are not authorized to mention this bot in DMs for jobs.',
        ...(eventTs ? { eventTs } : {}),
        ...(userId ? { userId } : {}),
      },
    );
  });
}
