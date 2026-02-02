import { fetchCodexUsageMessage } from '@sniptail/core/codex/status.js';
import { logger } from '@sniptail/core/logger.js';
import type { SlackHandlerContext } from '../context.js';

export function registerUsageCommand({ app, slackIds }: SlackHandlerContext) {
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
      const { message } = await fetchCodexUsageMessage();
      await client.chat.postEphemeral({
        channel: body.channel_id,
        user: userId,
        text: message,
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
