import { loadJobRecord } from '@sniptail/core/jobs/registry.js';
import { logger } from '@sniptail/core/logger.js';
import type { JobContextFile } from '@sniptail/core/types/job.js';
import type { SlackHandlerContext } from '../context.js';
import { loadSlackModalContextFiles, postMessage } from '../../helpers.js';
import { authorizeSlackOperationAndRespond } from '../../permissions/slackPermissionGuards.js';
import { submitNormalizedJobRequest } from '../../../job-requests/engine.js';

export function registerAnswerQuestionsSubmitView({
  app,
  slackIds,
  config,
  queue,
  permissions,
}: SlackHandlerContext) {
  app.view(slackIds.actions.answerQuestionsSubmit, async ({ ack, body, view, client }) => {
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
    let contextFiles: JobContextFile[] | undefined;

    try {
      const uploadedFiles = await loadSlackModalContextFiles({
        client,
        botToken: config.slack?.botToken,
        state: view.state.values,
      });
      contextFiles = uploadedFiles.length ? uploadedFiles : undefined;
    } catch (err) {
      logger.warn({ err, jobId }, 'Failed to load Slack modal context files for answer questions');
      await postMessage(app, {
        channel: body.user.id,
        text: `I couldn't use the uploaded files: ${(err as Error).message}`,
      });
      return;
    }

    const requestText = [record.job.requestText, answers && `Follow-up answers:\n${answers}`]
      .filter(Boolean)
      .join('\n\n');

    const channelId = metadata?.channelId ?? record.job.channel.channelId;
    const userId = metadata?.userId ?? record.job.channel.userId ?? body.user.id;
    const threadId = metadata?.threadId ?? record.job.channel.threadId;

    const result = await submitNormalizedJobRequest({
      config,
      queue,
      input: {
        type: 'PLAN',
        repoKeys: record.job.repoKeys,
        ...(record.job.gitRef ? { gitRef: record.job.gitRef } : {}),
        requestText,
        agent: record.job.agent ?? config.primaryAgent,
        channel: {
          provider: 'slack',
          channelId,
          userId,
          ...(threadId ? { threadId } : {}),
        },
        ...(contextFiles ? { contextFiles } : {}),
        resumeFromJobId: record.job.jobId,
      },
      authorize: async (job) =>
        authorizeSlackOperationAndRespond({
          permissions,
          client: app.client,
          slackIds,
          action: 'jobs.answerQuestions',
          summary: `Queue answer-questions job ${job.jobId}`,
          operation: {
            kind: 'enqueueJob',
            job,
          },
          actor: {
            userId,
            channelId,
            ...(threadId ? { threadId } : {}),
          },
          onDeny: async () => {
            await postMessage(app, {
              channel: channelId,
              text: 'You are not authorized to submit answers for this job.',
              ...(threadId ? { threadTs: threadId } : {}),
            });
          },
        }),
    });

    if (result.status === 'invalid') {
      await postMessage(app, {
        channel: channelId,
        text: result.message,
        ...(threadId ? { threadTs: threadId } : {}),
      });
      return;
    }

    if (result.status === 'stopped') {
      return;
    }

    if (result.status === 'persist_failed') {
      logger.error({ err: result.error, jobId: result.job.jobId }, 'Failed to persist answer questions job');
      await postMessage(app, {
        channel: channelId,
        text: `I couldn't persist job ${result.job.jobId}. Please try again.`,
        ...(threadId ? { threadTs: threadId } : {}),
      });
      return;
    }

    const job = result.job;

    await postMessage(app, {
      channel: channelId,
      text: `Thanks! I've accepted job ${job.jobId}. I'll report back here.`,
      ...(threadId ? { threadTs: threadId } : {}),
    });
  });
}
