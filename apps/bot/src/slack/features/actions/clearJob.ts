import { logger } from '@sniptail/core/logger.js';
import { enqueueWorkerEvent } from '@sniptail/core/queue/queue.js';
import { WORKER_EVENT_SCHEMA_VERSION } from '@sniptail/core/types/worker-event.js';
import type { SlackHandlerContext } from '../context.js';
import { postMessage } from '../../helpers.js';
import { authorizeSlackOperationAndRespond } from '../../permissions/slackPermissionGuards.js';

export function registerClearJobAction({
  app,
  slackIds,
  workerEventQueue,
  permissions,
}: SlackHandlerContext) {
  app.action(slackIds.actions.clearJob, async ({ ack, body, action }) => {
    await ack();
    const jobId = (action as { value?: string }).value?.trim();
    const channelId = (body as { channel?: { id?: string } }).channel?.id;
    const threadTs = (body as { message?: { ts?: string } }).message?.ts;
    const userId = (body as { user?: { id?: string } }).user?.id;

    if (!jobId || !userId) {
      if (channelId) {
        await postMessage(app, {
          channel: channelId,
          text: 'Unable to clear job: missing job id.',
          ...(threadTs ? { threadTs } : {}),
        });
      }
      return;
    }

    const event = {
      schemaVersion: WORKER_EVENT_SCHEMA_VERSION,
      type: 'jobs.clear' as const,
      payload: {
        jobId,
        ttlMs: 5 * 60_000,
      },
    };
    const authorized = await authorizeSlackOperationAndRespond({
      permissions,
      client: app.client,
      slackIds,
      action: 'jobs.clear',
      summary: `Clear job data for ${jobId}`,
      operation: {
        kind: 'enqueueWorkerEvent',
        event,
      },
      actor: {
        userId,
        channelId: channelId ?? '',
        ...(threadTs ? { threadId: threadTs } : {}),
      },
      onDeny: async () => {
        if (channelId) {
          await postMessage(app, {
            channel: channelId,
            text: 'You are not authorized to clear job data.',
            ...(threadTs ? { threadTs } : {}),
          });
        }
      },
    });
    if (!authorized) {
      return;
    }

    try {
      await enqueueWorkerEvent(workerEventQueue, event);
      if (channelId) {
        await postMessage(app, {
          channel: channelId,
          text: `Job ${jobId} will be cleared in 5 minutes.`,
          ...(threadTs ? { threadTs } : {}),
        });
      }
    } catch (err) {
      logger.error({ err, jobId }, 'Failed to schedule job deletion');
      if (channelId) {
        await postMessage(app, {
          channel: channelId,
          text: `Failed to schedule deletion for job ${jobId}.`,
          ...(threadTs ? { threadTs } : {}),
        });
      }
    }
  });
}
