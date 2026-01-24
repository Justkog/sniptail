import { enqueueJob } from '@sniptail/core/queue/index.js';
import { saveJobQueued, updateJobRecord } from '@sniptail/core/jobs/registry.js';
import { logger } from '@sniptail/core/logger.js';
import type { JobSettings, JobSpec } from '@sniptail/core/types/job.js';
import type { SlackAppContext } from '../context.js';
import { postMessage, uploadFile } from '../../helpers.js';
import { resolveDefaultBaseBranch } from '../../modals.js';
import { createJobId, persistJobSpec, persistSlackUploadSpec } from '../../lib/jobs.js';
import { parseCommaList } from '../../lib/parsing.js';
import { fetchSlackThreadContext } from '../../lib/threadContext.js';

export function registerImplementSubmitView({ app, slackIds, config, queue }: SlackAppContext) {
  app.view(slackIds.actions.implementSubmit, async ({ ack, body, view, client }) => {
    await ack();

    const state = view.state.values;
    const metadata = view.private_metadata
      ? (JSON.parse(view.private_metadata) as {
          channelId: string;
          userId: string;
          threadTs?: string;
        })
      : undefined;
    const repoKeys = state.repos?.repo_keys?.selected_options?.map((opt) => opt.value) ?? [];
    const gitRef =
      state.branch?.git_ref?.value?.trim() ||
      resolveDefaultBaseBranch(config.repoAllowlist, repoKeys[0]);
    const requestText = state.change?.request_text?.value ?? '';
    const reviewers = parseCommaList(state.reviewers?.reviewers?.value ?? undefined);
    const labels = parseCommaList(state.labels?.labels?.value ?? undefined);
    const resumeFromJobId = state.resume?.resume_from?.value?.trim() || undefined;

    if (!repoKeys.length) {
      await postMessage(app, {
        channel: metadata?.channelId ?? body.user.id,
        text: `Please select at least one repo for ${slackIds.commands.implement}.`,
      });
      return;
    }

    const settings: JobSettings = {};
    if (reviewers) settings.reviewers = reviewers;
    if (labels) settings.labels = labels;

    const slackThreadContext =
      metadata?.threadTs && metadata?.channelId
        ? await fetchSlackThreadContext(client, metadata.channelId, metadata.threadTs)
        : undefined;
    const jobBase: JobSpec = {
      jobId: createJobId('implement'),
      type: 'IMPLEMENT',
      repoKeys,
      primaryRepoKey: repoKeys[0]!,
      gitRef,
      requestText,
      slack: {
        channelId: metadata?.channelId ?? body.user.id,
        userId: metadata?.userId ?? body.user.id,
        ...(metadata?.threadTs ? { threadTs: metadata.threadTs } : {}),
      },
      ...(slackThreadContext ? { slackThreadContext } : {}),
      ...(resumeFromJobId ? { resumeFromJobId } : {}),
    };
    const job: JobSpec = Object.keys(settings).length ? { ...jobBase, settings } : jobBase;

    let jobSpecPath: string | null = null;
    try {
      await saveJobQueued(job);
      jobSpecPath = await persistJobSpec(config, job);
    } catch (err) {
      logger.error({ err, jobId: job.jobId }, 'Failed to persist job');
      await postMessage(app, {
        channel: metadata?.channelId ?? body.user.id,
        text: `I couldn't persist job ${job.jobId}. Please try again.`,
      });
      return;
    }

    await enqueueJob(queue, job);

    const ackResponse = await postMessage(app, {
      channel: metadata?.channelId ?? body.user.id,
      text: `Thanks! I've accepted job ${job.jobId}. I'll report back here.`,
      ...(metadata?.threadTs ? { threadTs: metadata.threadTs } : {}),
    });

    const ackThreadTs = metadata?.threadTs ?? ackResponse?.ts;
    if (ackThreadTs) {
      const requestSummary = requestText.trim() || 'No request text provided.';
      await postMessage(app, {
        channel: metadata?.channelId ?? body.user.id,
        text: `*Job request*\n\`\`\`\n${requestSummary}\n\`\`\``,
        threadTs: ackThreadTs,
      }).catch((err) => {
        logger.warn({ err, jobId: job.jobId }, 'Failed to post job request');
      });
    }
    if (config.debugJobSpecMessages && jobSpecPath) {
      const uploadSpecPath = await persistSlackUploadSpec(config, job);
      if (!uploadSpecPath) {
        logger.warn({ jobId: job.jobId }, 'Skipping job spec upload without sanitized artifact');
      } else {
        const jobSpecOptions = {
          channel: metadata?.channelId ?? body.user.id,
          filePath: uploadSpecPath,
          title: `sniptail-${job.jobId}-job-spec.json`,
        };
        await uploadFile(
          app,
          ackThreadTs ? { ...jobSpecOptions, threadTs: ackThreadTs } : jobSpecOptions,
        ).catch((err) => {
          logger.warn({ err, jobId: job.jobId }, 'Failed to upload job spec artifact');
        });
      }
    }

    if (!metadata?.threadTs && ackResponse?.ts) {
      await updateJobRecord(job.jobId, {
        job: {
          ...job,
          slack: {
            ...job.slack,
            threadTs: ackResponse.ts,
          },
        },
      }).catch((err) => {
        logger.warn({ err, jobId: job.jobId }, 'Failed to record job thread timestamp');
      });
    }
  });
}
