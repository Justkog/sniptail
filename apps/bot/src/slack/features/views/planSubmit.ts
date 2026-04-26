import { updateJobRecord } from '@sniptail/core/jobs/registry.js';
import { logger } from '@sniptail/core/logger.js';
import type { JobContextFile } from '@sniptail/core/types/job.js';
import { toSlackCommandPrefix } from '@sniptail/core/utils/slack.js';
import { rm } from 'node:fs/promises';
import type { SlackHandlerContext } from '../context.js';
import { loadSlackModalContextFiles, postMessage, uploadFile } from '../../helpers.js';
import { persistUploadSpec, truncateRequestSummary } from '../../../lib/jobs.js';
import { resolveDefaultBaseBranch } from '../../../lib/repoBaseBranch.js';
import { fetchSlackThreadContext } from '../../lib/threadContext.js';
import { authorizeSlackOperationAndRespond } from '../../permissions/slackPermissionGuards.js';
import { submitNormalizedJobRequest } from '../../../job-requests/engine.js';

export function registerPlanSubmitView({
  app,
  slackIds,
  config,
  queue,
  permissions,
}: SlackHandlerContext) {
  app.view(slackIds.actions.planSubmit, async ({ ack, body, view, client }) => {
    await ack();

    const state = view.state.values;
    const metadata = view.private_metadata
      ? (JSON.parse(view.private_metadata) as {
          channelId: string;
          userId: string;
          threadId?: string;
        })
      : undefined;
    const repoKeys = state.repos?.repo_keys?.selected_options?.map((opt) => opt.value) ?? [];
    const gitRef =
      state.branch?.git_ref?.value?.trim() ||
      resolveDefaultBaseBranch(config.repoAllowlist, repoKeys[0]);
    const requestText = state.question?.request_text?.value ?? '';
    const resumeFromJobId = state.resume?.resume_from?.value?.trim() || undefined;
    let contextFiles: JobContextFile[] | undefined;

    try {
      const uploadedFiles = await loadSlackModalContextFiles({
        client: app.client,
        botToken: config.slack?.botToken,
        state,
      });
      contextFiles = uploadedFiles.length ? uploadedFiles : undefined;
    } catch (err) {
      logger.warn({ err }, 'Failed to load Slack modal context files for plan job');
      await postMessage(app, {
        channel: metadata?.channelId ?? body.user.id,
        text: `I couldn't use the uploaded files: ${(err as Error).message}`,
      });
      return;
    }

    if (!repoKeys.length) {
      await postMessage(app, {
        channel: metadata?.channelId ?? body.user.id,
        text: `Please select at least one repo for ${slackIds.commands.plan}.`,
      });
      return;
    }

    const threadContext =
      metadata?.threadId && metadata?.channelId
        ? await fetchSlackThreadContext(client, metadata.channelId, metadata.threadId)
        : undefined;
    const result = await submitNormalizedJobRequest({
      config,
      queue,
      input: {
        type: 'PLAN',
        repoKeys,
        ...(gitRef ? { gitRef } : {}),
        requestText,
        channel: {
          provider: 'slack',
          channelId: metadata?.channelId ?? body.user.id,
          userId: metadata?.userId ?? body.user.id,
          ...(metadata?.threadId ? { threadId: metadata.threadId } : {}),
        },
        ...(threadContext ? { threadContext } : {}),
        ...(contextFiles ? { contextFiles } : {}),
        ...(resumeFromJobId ? { resumeFromJobId } : {}),
      },
      authorize: async (job) =>
        authorizeSlackOperationAndRespond({
          permissions,
          client: app.client,
          slackIds,
          action: 'jobs.plan',
          summary: `Queue plan job ${job.jobId}`,
          operation: {
            kind: 'enqueueJob',
            job,
          },
          actor: {
            userId: job.channel.userId ?? body.user.id,
            channelId: job.channel.channelId,
            ...(job.channel.threadId ? { threadId: job.channel.threadId } : {}),
          },
          onDeny: async () => {
            await postMessage(app, {
              channel: metadata?.channelId ?? body.user.id,
              text: 'You are not authorized to run plan jobs.',
            });
          },
        }),
    });

    if (result.status === 'invalid') {
      await postMessage(app, {
        channel: metadata?.channelId ?? body.user.id,
        text: result.message,
      });
      return;
    }

    if (result.status === 'stopped') {
      return;
    }

    if (result.status === 'persist_failed') {
      logger.error({ err: result.error, jobId: result.job.jobId }, 'Failed to persist job');
      await postMessage(app, {
        channel: metadata?.channelId ?? body.user.id,
        text: `I couldn't persist job ${result.job.jobId}. Please try again.`,
      });
      return;
    }

    const job = result.job;

    const requestSummary = truncateRequestSummary(requestText);
    const ackResponse = await postMessage(app, {
      channel: metadata?.channelId ?? body.user.id,
      text: `*Job request: ${job.jobId}*\n\`\`\`\n${requestSummary}\n\`\`\``,
      ...(job.contextFiles?.length ? { contextFiles: job.contextFiles } : {}),
      ...(metadata?.threadId ? { threadTs: metadata.threadId } : {}),
    });

    const ackThreadId = metadata?.threadId ?? ackResponse?.ts;
    if (config.debugJobSpecMessages) {
      const botNamePrefix = toSlackCommandPrefix(config.botName);
      const uploadSpecPath = await persistUploadSpec(job);
      if (!uploadSpecPath) {
        logger.warn({ jobId: job.jobId }, 'Skipping job spec upload without sanitized artifact');
      } else {
        const jobSpecOptions = {
          channel: metadata?.channelId ?? body.user.id,
          filePath: uploadSpecPath,
          title: `${botNamePrefix}-${job.jobId}-job-spec.json`,
        };
        try {
          await uploadFile(
            app,
            ackThreadId ? { ...jobSpecOptions, threadTs: ackThreadId } : jobSpecOptions,
          );
        } catch (err) {
          logger.warn({ err, jobId: job.jobId }, 'Failed to upload job spec artifact');
        } finally {
          await rm(uploadSpecPath, { force: true }).catch((err) => {
            logger.warn({ err, jobId: job.jobId }, 'Failed to remove job spec upload artifact');
          });
        }
      }
    }

    if (ackResponse?.ts) {
      await updateJobRecord(job.jobId, {
        job: {
          ...job,
          channel: {
            ...job.channel,
            ...(!metadata?.threadId ? { threadId: ackResponse.ts } : {}),
            requestMessageId: ackResponse.ts,
          },
        },
      }).catch((err) => {
        logger.warn({ err, jobId: job.jobId }, 'Failed to record job request message context');
      });
    }
  });
}
