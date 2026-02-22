import { logger } from '@sniptail/core/logger.js';
import { enqueueWorkerEvent } from '@sniptail/core/queue/queue.js';
import { WORKER_EVENT_SCHEMA_VERSION } from '@sniptail/core/types/worker-event.js';
import type { SlackHandlerContext } from '../context.js';
import { parseCutoffDateInput } from '../../lib/parsing.js';
import { authorizeSlackOperationAndRespond } from '../../permissions/slackPermissionGuards.js';

export function registerClearBeforeCommand({
  app,
  slackIds,
  permissions,
  workerEventQueue,
}: SlackHandlerContext) {
  app.command(slackIds.commands.clearBefore, async ({ ack, body, client }) => {
    const userId = body.user_id;
    if (!userId) return;

    const cutoff = parseCutoffDateInput(body.text ?? '');
    if (!cutoff) {
      await ack({
        response_type: 'ephemeral',
        text: `Usage: ${slackIds.commands.clearBefore} YYYY-MM-DD (or ISO timestamp).`,
      });
      return;
    }

    const event = {
      schemaVersion: WORKER_EVENT_SCHEMA_VERSION,
      type: 'jobs.clearBefore' as const,
      payload: {
        cutoffIso: cutoff.toISOString(),
      },
    };
    const authorized = await authorizeSlackOperationAndRespond({
      permissions,
      client,
      slackIds,
      action: 'jobs.clearBefore',
      summary: `Clear jobs created before ${cutoff.toISOString()}`,
      operation: {
        kind: 'enqueueWorkerEvent',
        event,
      },
      actor: {
        userId,
        channelId: body.channel_id,
        ...(body.thread_ts ? { threadId: body.thread_ts as string } : {}),
        workspaceId: body.team_id,
      },
      onDeny: async () => {
        await ack({
          response_type: 'ephemeral',
          text: 'You are not authorized to clear jobs.',
        });
      },
      onRequireApprovalNotice: async (message) => {
        await ack({
          response_type: 'ephemeral',
          text: message,
        });
      },
    });
    if (!authorized) {
      return;
    }

    await ack({
      response_type: 'ephemeral',
      text: `Clearing jobs created before ${cutoff.toISOString()}...`,
    });

    try {
      await enqueueWorkerEvent(workerEventQueue, {
        ...event,
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
