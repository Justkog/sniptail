import { logger } from '@sniptail/core/logger.js';
import { enqueueWorkerEvent } from '@sniptail/core/queue/queue.js';
import type { SlackHandlerContext } from '../context.js';

export function registerUsageCommand({ app, slackIds, workerEventQueue }: SlackHandlerContext) {
  app.command(slackIds.commands.usage, async ({ ack, body, client }) => {
    await ack({
      response_type: 'ephemeral',
      text: 'Checking Codex usage...',
    });

    const userId = body.user_id;
    if (!userId) {
      return;
    }

    try {
      await enqueueWorkerEvent(workerEventQueue, {
        type: 'codexUsage',
        payload: {
          provider: 'slack',
          channelId: body.channel_id,
          userId,
          ...((body.thread_ts as string | undefined) ? { threadId: body.thread_ts as string } : {}),
        },
      });
    } catch (err) {
      logger.error({ err }, 'Failed to fetch Codex usage status');
      await client.chat.postEphemeral({
        channel: body.channel_id,
        user: userId,
        text: 'Failed to fetch Codex usage status. Please try again shortly.',
      });
    }
  });
}
