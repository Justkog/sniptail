import { enqueueJob } from '@sniptail/core/queue/queue.js';
import { loadJobRecord, saveJobQueued, updateJobRecord } from '@sniptail/core/jobs/registry.js';
import { logger } from '@sniptail/core/logger.js';
import type { JobSpec } from '@sniptail/core/types/job.js';
import type { SlackHandlerContext } from '../context.js';
import { postMessage } from '../../helpers.js';
import { createJobId } from '../../../lib/jobs.js';
import { authorizeSlackOperationAndRespond } from '../../permissions/slackPermissionGuards.js';

export function registerReviewFromJobAction({
  app,
  slackIds,
  config,
  queue,
  permissions,
}: SlackHandlerContext) {
  app.action(slackIds.actions.reviewFromJob, async ({ ack, body, action }) => {
    await ack();
    const jobId = (action as { value?: string }).value?.trim();
    const channelId = (body as { channel?: { id?: string } }).channel?.id;
    const threadId =
      (body as { message?: { thread_ts?: string; ts?: string } }).message?.thread_ts ??
      (body as { message?: { ts?: string } }).message?.ts;
    const userId = (body as { user?: { id?: string } }).user?.id;

    if (!jobId || !channelId || !userId) {
      return;
    }

    const record = await loadJobRecord(jobId).catch((err) => {
      logger.warn({ err, jobId }, 'Failed to load job record for review from job');
      return undefined;
    });

    const repoKeys = record?.job?.repoKeys ?? [];
    const gitRef = record?.job?.gitRef;
    if (!repoKeys.length || !gitRef) {
      await postMessage(app, {
        channel: channelId,
        text: `Unable to start a review for job ${jobId}.`,
        ...(threadId ? { threadTs: threadId } : {}),
      });
      return;
    }

    const effectiveThreadId = threadId ?? record?.job?.channel?.threadId;
    const job: JobSpec = {
      jobId: createJobId('review'),
      type: 'REVIEW',
      repoKeys,
      ...(repoKeys[0] ? { primaryRepoKey: repoKeys[0] } : {}),
      gitRef,
      requestText: `Review changes for job ${jobId}.`,
      agent: config.primaryAgent,
      channel: {
        provider: 'slack',
        channelId,
        userId,
        ...(effectiveThreadId ? { threadId: effectiveThreadId } : {}),
      },
      resumeFromJobId: jobId,
      ...(record?.job?.threadContext ? { threadContext: record.job.threadContext } : {}),
    };

    const authorized = await authorizeSlackOperationAndRespond({
      permissions,
      client: app.client,
      slackIds,
      action: 'jobs.review',
      summary: `Start review job from ${jobId}`,
      operation: {
        kind: 'enqueueJob',
        job,
      },
      actor: {
        userId,
        channelId,
        ...(effectiveThreadId ? { threadId: effectiveThreadId } : {}),
      },
      onDeny: async () => {
        await postMessage(app, {
          channel: channelId,
          text: 'You are not authorized to start review jobs.',
          ...(effectiveThreadId ? { threadTs: effectiveThreadId } : {}),
        });
      },
    });
    if (!authorized) {
      return;
    }

    try {
      await saveJobQueued(job);
    } catch (err) {
      logger.error({ err, jobId: job.jobId }, 'Failed to persist review job');
      await postMessage(app, {
        channel: channelId,
        text: `I couldn't persist review job ${job.jobId}. Please try again.`,
        ...(effectiveThreadId ? { threadTs: effectiveThreadId } : {}),
      });
      return;
    }

    await enqueueJob(queue, job);

    const ackResponse = await postMessage(app, {
      channel: channelId,
      text: `Thanks! I've queued review job ${job.jobId}. I'll report back here.`,
      ...(effectiveThreadId ? { threadTs: effectiveThreadId } : {}),
    });

    if (!effectiveThreadId && ackResponse?.ts) {
      await updateJobRecord(job.jobId, {
        job: {
          ...job,
          channel: {
            ...job.channel,
            threadId: ackResponse.ts,
          },
        },
      }).catch((err) => {
        logger.warn({ err, jobId: job.jobId }, 'Failed to record review job thread timestamp');
      });
    }
  });
}
