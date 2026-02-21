import { logger } from '@sniptail/core/logger.js';
import { enqueueWorkerEvent } from '@sniptail/core/queue/queue.js';
import { WORKER_EVENT_SCHEMA_VERSION } from '@sniptail/core/types/worker-event.js';
import type { SlackHandlerContext } from '../context.js';
import { authorizeSlackOperationAndRespond } from '../../permissions/slackPermissionGuards.js';

export function registerUsageCommand({
  app,
  slackIds,
  workerEventQueue,
  permissions,
}: SlackHandlerContext) {
  app.command(slackIds.commands.usage, async ({ ack, body, client }) => {
    const userId = body.user_id;
    if (!userId) {
      return;
    }

    const event = {
      schemaVersion: WORKER_EVENT_SCHEMA_VERSION,
      type: 'status.codexUsage' as const,
      payload: {
        provider: 'slack' as const,
        channelId: body.channel_id,
        userId,
        ...((body.thread_ts as string | undefined) ? { threadId: body.thread_ts as string } : {}),
      },
    };
    const authorized = await authorizeSlackOperationAndRespond({
      permissions,
      client,
      slackIds,
      action: 'status.codexUsage',
      summary: 'Check Codex usage status',
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
          text: 'You are not authorized to check Codex usage.',
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
      text: 'Checking Codex usage...',
    });

    try {
      await enqueueWorkerEvent(workerEventQueue, event);
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
