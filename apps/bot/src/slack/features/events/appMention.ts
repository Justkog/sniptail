import { logger } from '@sniptail/core/logger.js';
import type { SlackHandlerContext } from '../context.js';
import { addReaction } from '../../helpers.js';
import { queueSlackMentionJob } from './slackMentionEventRouting.js';

export function registerAppMentionEvent({
  app,
  config,
  queue,
  permissions,
  slackIds,
}: SlackHandlerContext) {
  app.event('app_mention', async ({ event, client }) => {
    const channelId = (event as { channel?: string }).channel;
    const text = (event as { text?: string }).text ?? '';
    const threadId =
      (event as { thread_ts?: string; ts?: string }).thread_ts ?? (event as { ts?: string }).ts;
    const eventTs = (event as { ts?: string }).ts;
    const botId = (event as { bot_id?: string }).bot_id;
    const userId = (event as { user?: string }).user;

    logger.info({ channelId, threadId, botId, text }, 'Received app_mention event');

    if (!channelId || !threadId || botId) {
      return;
    }

    if (channelId && eventTs) {
      await addReaction(app, {
        channel: channelId,
        name: 'eyes',
        timestamp: eventTs,
      });
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
        dedupeMode: 'mention',
        onDenyText: 'You are not authorized to mention this bot for jobs.',
        ...(eventTs ? { eventTs } : {}),
        ...(userId ? { userId } : {}),
        ...((event as { team?: string }).team
          ? { workspaceId: (event as { team?: string }).team }
          : {}),
      },
    );
  });
}
