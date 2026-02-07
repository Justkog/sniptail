import { enqueueJob } from '@sniptail/core/queue/queue.js';
import { loadJobRecord, saveJobQueued } from '@sniptail/core/jobs/registry.js';
import { logger } from '@sniptail/core/logger.js';
import type { JobSpec } from '@sniptail/core/types/job.js';
import type { SlackHandlerContext } from '../context.js';
import { postMessage } from '../../helpers.js';
import { createJobId } from '../../../lib/jobs.js';

export function registerAnswerQuestionsSubmitView({
  app,
  slackIds,
  config,
  queue,
}: SlackHandlerContext) {
  app.view(slackIds.actions.answerQuestionsSubmit, async ({ ack, body, view }) => {
    await ack();

    const metadata = view.private_metadata
      ? (JSON.parse(view.private_metadata) as {
          jobId: string;
          channelId?: string;
          userId?: string;
          threadId?: string;
        })
      : undefined;

    const jobId = metadata?.jobId;
    if (!jobId) {
      await postMessage(app, {
        channel: body.user.id,
        text: 'Missing job context for answering questions.',
      });
      return;
    }

    const record = await loadJobRecord(jobId).catch((err) => {
      logger.warn({ err, jobId }, 'Failed to load job record for answer questions submit');
      return undefined;
    });

    if (!record) {
      await postMessage(app, {
        channel: body.user.id,
        text: `Unable to find job ${jobId}. Please try again.`,
      });
      return;
    }

    const answers = view.state.values.answers?.answers?.value?.trim() ?? '';
    const requestText = [record.job.requestText, answers && `Follow-up answers:\n${answers}`]
      .filter(Boolean)
      .join('\n\n');

    const channelId = metadata?.channelId ?? record.job.channel.channelId;
    const userId = metadata?.userId ?? record.job.channel.userId;
    const threadId = metadata?.threadId ?? record.job.channel.threadId;

    const job: JobSpec = {
      jobId: createJobId('plan'),
      type: 'PLAN',
      repoKeys: record.job.repoKeys,
      ...(record.job.primaryRepoKey ? { primaryRepoKey: record.job.primaryRepoKey } : {}),
      gitRef: record.job.gitRef,
      requestText,
      agent: record.job.agent ?? config.primaryAgent,
      channel: {
        provider: 'slack',
        channelId,
        userId,
        ...(threadId ? { threadId } : {}),
      },
      resumeFromJobId: record.job.jobId,
    };

    try {
      await saveJobQueued(job);
    } catch (err) {
      logger.error({ err, jobId: job.jobId }, 'Failed to persist answer questions job');
      await postMessage(app, {
        channel: channelId,
        text: `I couldn't persist job ${job.jobId}. Please try again.`,
        ...(threadId ? { threadTs: threadId } : {}),
      });
      return;
    }

    await enqueueJob(queue, job);

    await postMessage(app, {
      channel: channelId,
      text: `Thanks! I've accepted job ${job.jobId}. I'll report back here.`,
      ...(threadId ? { threadTs: threadId } : {}),
    });
  });
}
