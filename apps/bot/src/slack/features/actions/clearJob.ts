import { logger } from '@sniptail/core/logger.js';
import { enqueueWorkerEvent } from '@sniptail/core/queue/index.js';
import type { SlackAppContext } from '../context.js';
import { postMessage } from '../../helpers.js';

export function registerClearJobAction({ app, slackIds, workerEventQueue }: SlackAppContext) {
  app.action(slackIds.actions.clearJob, async ({ ack, body, action }) => {
    await ack();
    const jobId = (action as { value?: string }).value?.trim();
    const channelId = (body as { channel?: { id?: string } }).channel?.id;
    const threadTs = (body as { message?: { ts?: string } }).message?.ts;

    if (!jobId) {
      if (channelId) {
        await postMessage(app, {
          channel: channelId,
          text: 'Unable to clear job: missing job id.',
          ...(threadTs ? { threadTs } : {}),
        });
      }
      return;
    }

    try {
      await enqueueWorkerEvent(workerEventQueue, {
        type: 'clearJob',
        payload: {
          jobId,
          ttlMs: 5 * 60_000,
        },
      });
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
