import { logger } from '@sniptail/core/logger.js';
import { enqueueWorkerEvent } from '@sniptail/core/queue/index.js';
import type { SlackAppContext } from '../context.js';
import { parseCutoffDateInput } from '../../lib/parsing.js';

export function registerClearBeforeCommand({ app, slackIds, config, workerEventQueue }: SlackAppContext) {
  app.command(slackIds.commands.clearBefore, async ({ ack, body, client }) => {
    const userId = body.user_id;
    if (!userId || !config.adminUserIds.includes(userId)) {
      await ack({
        response_type: 'ephemeral',
        text: 'You are not authorized to clear jobs.',
      });
      return;
    }

    const cutoff = parseCutoffDateInput(body.text ?? '');
    if (!cutoff) {
      await ack({
        response_type: 'ephemeral',
        text: `Usage: ${slackIds.commands.clearBefore} YYYY-MM-DD (or ISO timestamp).`,
      });
      return;
    }

    await ack({
      response_type: 'ephemeral',
      text: `Clearing jobs created before ${cutoff.toISOString()}...`,
    });

    try {
      await enqueueWorkerEvent(workerEventQueue, {
        type: 'clearJobsBefore',
        payload: {
          cutoffIso: cutoff.toISOString(),
        },
      });
      await client.chat.postEphemeral({
        channel: body.channel_id,
        user: userId,
        text: `Scheduled clearing jobs created before ${cutoff.toISOString()}.`,
      });
    } catch (err) {
      logger.error({ err, cutoff: cutoff.toISOString() }, 'Failed to clear jobs before cutoff');
      await client.chat.postEphemeral({
        channel: body.channel_id,
        user: userId,
        text: `Failed to clear jobs before ${cutoff.toISOString()}.`,
      });
    }
  });
}
