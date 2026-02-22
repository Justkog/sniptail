import { enqueueJob } from '@sniptail/core/queue/queue.js';
import { saveJobQueued, updateJobRecord } from '@sniptail/core/jobs/registry.js';
import { logger } from '@sniptail/core/logger.js';
import { normalizeRunActionId } from '@sniptail/core/repos/runActions.js';
import type { JobSpec } from '@sniptail/core/types/job.js';
import { rm } from 'node:fs/promises';
import type { SlackHandlerContext } from '../context.js';
import { postMessage, uploadFile } from '../../helpers.js';
import { resolveDefaultBaseBranch } from '../../modals.js';
import { createJobId, persistUploadSpec } from '../../../lib/jobs.js';
import { fetchSlackThreadContext } from '../../lib/threadContext.js';
import { authorizeSlackOperationAndRespond } from '../../permissions/slackPermissionGuards.js';
import { computeAvailableRunActions } from '../../../lib/botRunActionAvailability.js';

export function registerRunSubmitView({
  app,
  slackIds,
  config,
  queue,
  permissions,
}: SlackHandlerContext) {
  app.view(slackIds.actions.runSubmit, async ({ ack, body, view, client }) => {
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
    const actionIdRaw =
      state.run_action?.[slackIds.actions.runActionSelect]?.selected_option?.value?.trim() ?? '';

    if (!repoKeys.length) {
      await postMessage(app, {
        channel: metadata?.channelId ?? body.user.id,
        text: `Please select at least one repo for ${slackIds.commands.run}.`,
      });
      return;
    }

    let actionId: string;
    try {
      actionId = normalizeRunActionId(actionIdRaw);
    } catch {
      await postMessage(app, {
        channel: metadata?.channelId ?? body.user.id,
        text: 'Please choose a valid run action.',
      });
      return;
    }

    const availableActions = computeAvailableRunActions(config, repoKeys);
    if (!availableActions.some((action) => action.id === actionId)) {
      await postMessage(app, {
        channel: metadata?.channelId ?? body.user.id,
        text: 'That run action is not available for the selected repositories.',
      });
      return;
    }

    const threadContext =
      metadata?.threadId && metadata?.channelId
        ? await fetchSlackThreadContext(client, metadata.channelId, metadata.threadId)
        : undefined;

    const job: JobSpec = {
      jobId: createJobId('run'),
      type: 'RUN',
      repoKeys,
      primaryRepoKey: repoKeys[0]!,
      gitRef,
      requestText: `Run action ${actionId}`,
      run: { actionId },
      agent: config.primaryAgent,
      channel: {
        provider: 'slack',
        channelId: metadata?.channelId ?? body.user.id,
        userId: metadata?.userId ?? body.user.id,
        ...(metadata?.threadId ? { threadId: metadata.threadId } : {}),
      },
      ...(threadContext ? { threadContext } : {}),
    };

    const authorized = await authorizeSlackOperationAndRespond({
      permissions,
      client: app.client,
      slackIds,
      action: 'jobs.run',
      summary: `Queue run job ${job.jobId}`,
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
          text: 'You are not authorized to run custom actions.',
        });
      },
    });
    if (!authorized) {
      return;
    }

    try {
      await saveJobQueued(job);
    } catch (err) {
      logger.error({ err, jobId: job.jobId }, 'Failed to persist run job');
      await postMessage(app, {
        channel: metadata?.channelId ?? body.user.id,
        text: `I couldn't persist job ${job.jobId}. Please try again.`,
      });
      return;
    }

    await enqueueJob(queue, job);

    const ackResponse = await postMessage(app, {
      channel: metadata?.channelId ?? body.user.id,
      text: `Thanks! I've accepted run job ${job.jobId} (action: ${actionId}). I'll report back here.`,
      ...(metadata?.threadId ? { threadTs: metadata.threadId } : {}),
    });

    const ackThreadId = metadata?.threadId ?? ackResponse?.ts;
    if (config.debugJobSpecMessages) {
      const uploadSpecPath = await persistUploadSpec(job);
      if (!uploadSpecPath) {
        logger.warn({ jobId: job.jobId }, 'Skipping job spec upload without sanitized artifact');
      } else {
        const jobSpecOptions = {
          channel: metadata?.channelId ?? body.user.id,
          filePath: uploadSpecPath,
          title: `sniptail-${job.jobId}-job-spec.json`,
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

    if (!metadata?.threadId && ackResponse?.ts) {
      await updateJobRecord(job.jobId, {
        job: {
          ...job,
          channel: {
            ...job.channel,
            threadId: ackResponse.ts,
          },
        },
      }).catch((err) => {
        logger.warn({ err, jobId: job.jobId }, 'Failed to record job thread timestamp');
      });
    }
  });
}
