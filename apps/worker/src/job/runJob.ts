import { join } from 'node:path';
import { loadWorkerConfig } from '@sniptail/core/config/config.js';
import { buildJobPaths, validateJob } from '@sniptail/core/jobs/utils.js';
import { logger } from '@sniptail/core/logger.js';
import type { ChannelRef } from '@sniptail/core/types/channel.js';
import type { JobResult, MergeRequestResult, JobSpec } from '@sniptail/core/types/job.js';
import { createRepoReviewRequest, inferRepoProvider } from '@sniptail/core/repos/providers.js';
import { buildMergeRequestDescription } from '../merge-requests/description.js';
import type { BotEventSink } from '../channels/botEventSink.js';
import { resolveWorkerChannelAdapter } from '../channels/workerChannelAdapters.js';
import { createNotifier } from '../channels/createNotifier.js';
import { loadRepoAllowlistFromCatalog } from '@sniptail/core/repos/catalog.js';
import {
  copyArtifactsFromResumedJob,
  copyJobRootSeed,
  ensureJobDirectories,
  readJobPlan,
  readJobReport,
  readJobSummary,
  writeJobSpecArtifact,
} from './artifacts.js';
import { resolveThreadId } from './records.js';
import type { JobRegistry } from './jobRegistry.js';
import { prepareRepoWorktrees } from '../repos/worktrees.js';
import { ensureRepoClean, runRepoChecks } from '../repos/checks.js';
import { commitRepoChanges } from '../repos/commit.js';
import { runAgentJob } from '../agents/runAgent.js';
import { enforceJobCleanup } from './cleanup.js';

const config = loadWorkerConfig();
const branchPrefix = 'sniptail';

function buildChannelRef(job: JobSpec, threadId?: string): ChannelRef {
  return {
    provider: job.channel.provider,
    channelId: job.channel.channelId,
    ...(threadId ? { threadId } : {}),
  };
}

function isMissingArtifact(err: unknown): boolean {
  return (err as NodeJS.ErrnoException | undefined)?.code === 'ENOENT';
}

async function recordAgentThreadId(
  registry: JobRegistry,
  job: JobSpec,
  agentId: string,
  threadId: string,
): Promise<void> {
  const existingRecord = await registry.loadJobRecord(job.jobId).catch((err) => {
    logger.warn({ err, jobId: job.jobId }, 'Failed to load job record for agent thread id update');
    return undefined;
  });
  const existingJob = existingRecord?.job ?? job;
  await registry
    .updateJobRecord(job.jobId, {
      job: {
        ...existingJob,
        agentThreadIds: {
          ...(existingJob.agentThreadIds ?? {}),
          [agentId]: threadId,
        },
      },
    })
    .catch((err) => {
      logger.warn({ err, jobId: job.jobId }, 'Failed to record agent thread id');
    });
}

export async function runJob(
  events: BotEventSink,
  job: JobSpec,
  registry: JobRegistry,
): Promise<JobResult> {
  const repoAllowlist = await loadRepoAllowlistFromCatalog();
  config.repoAllowlist = repoAllowlist;
  validateJob(job, repoAllowlist);
  const notifier = createNotifier(events);
  const channelAdapter = resolveWorkerChannelAdapter(job.channel.provider);

  await registry.updateJobRecord(job.jobId, { status: 'running' }).catch((err) => {
    logger.warn({ err, jobId: job.jobId }, 'Failed to mark job as running');
  });

  const paths = buildJobPaths(config.jobWorkRoot, job.jobId);
  await ensureJobDirectories(paths);
  await writeJobSpecArtifact(paths, job);

  const env = {
    ...process.env,
    ...(config.openAiKey ? { OPENAI_API_KEY: config.openAiKey } : {}),
    ...(config.jobRootCopyGlob ? { JOB_ROOT_COPY_GLOB: config.jobRootCopyGlob } : {}),
  };

  const redactionPatterns = [
    config.gitlab?.token ?? '',
    config.github?.token ?? '',
    config.openAiKey ?? '',
  ].filter(Boolean);

  const resumeRecord = job.resumeFromJobId
    ? await registry.loadJobRecord(job.resumeFromJobId)
    : null;
  if (job.resumeFromJobId && !resumeRecord) {
    throw new Error(`Resume job not found: ${job.resumeFromJobId}`);
  }

  try {
    await copyJobRootSeed(
      config.jobRootCopyGlob,
      paths.root,
      env,
      paths.logFile,
      redactionPatterns,
    );
    if (job.resumeFromJobId) {
      await copyArtifactsFromResumedJob(job.resumeFromJobId, config.jobWorkRoot, paths).catch(
        (err) => {
          logger.warn(
            { err, jobId: job.jobId, resumeFromJobId: job.resumeFromJobId },
            'Failed to copy artifacts from resumed job',
          );
        },
      );
    }

    const { repoWorktrees, branchByRepo } = await prepareRepoWorktrees({
      job,
      config,
      paths,
      env,
      redactionPatterns,
      ...(resumeRecord ? { resumeRecord } : {}),
      branchPrefix,
    });

    if (Object.keys(branchByRepo).length) {
      await registry.updateJobRecord(job.jobId, { branchByRepo }).catch((err) => {
        logger.warn({ err, jobId: job.jobId }, 'Failed to record job branches');
      });
    }

    const agentRun = await runAgentJob({ job, config, paths, env, registry });

    if (agentRun.result.threadId) {
      await recordAgentThreadId(registry, job, agentRun.agentId, agentRun.result.threadId);
    }

    if (job.type === 'MENTION') {
      const replyText = agentRun.result.finalResponse || 'Thanks for the mention! How can I help?';
      const threadId = await resolveThreadId(job, registry);
      const channelRef = buildChannelRef(job, threadId);
      await notifier.postMessage(channelRef, replyText);
      await registry
        .updateJobRecord(job.jobId, {
          status: 'ok',
          summary: replyText.slice(0, 500),
        })
        .catch((err) => {
          logger.warn({ err, jobId: job.jobId }, 'Failed to mark job as ok');
        });
      return {
        jobId: job.jobId,
        status: 'ok',
        summary: replyText.slice(0, 500),
      };
    }

    if (job.type === 'ASK' || job.type === 'PLAN' || job.type === 'REVIEW') {
      const reportFileName = job.type === 'PLAN' ? 'plan.md' : 'report.md';
      const reportPath = join(paths.artifactsRoot, reportFileName);
      const agentResponse = agentRun.result.finalResponse?.trim() ?? '';
      let report = '';
      let planMissing = false;

      if (job.type === 'PLAN') {
        try {
          report = await readJobPlan(paths);
        } catch (err) {
          if (!isMissingArtifact(err)) {
            throw err;
          }
          planMissing = true;
          logger.warn({ err, jobId: job.jobId }, 'Missing plan.md for PLAN job');
        }
      } else {
        report = await readJobReport(paths);
      }

      const openQuestions =
        job.type === 'PLAN' && planMissing && agentResponse
          ? [agentResponse]
          : job.type === 'PLAN' && planMissing
            ? ['Please answer any outstanding questions so I can finalize the plan.']
            : [];
      if (job.type === 'PLAN' && openQuestions.length) {
        await registry.updateJobRecord(job.jobId, { openQuestions }).catch((err) => {
          logger.warn({ err, jobId: job.jobId }, 'Failed to persist open questions');
        });
      }
      for (const repo of repoWorktrees.values()) {
        await ensureRepoClean(repo.worktreePath, env, paths.logFile, redactionPatterns);
      }
      const threadId = await resolveThreadId(job, registry);
      const channelRef = buildChannelRef(job, threadId);
      if (report) {
        await notifier.uploadFile(channelRef, {
          fileContent: report,
          title: `sniptail-${job.jobId}-${reportFileName}`,
        });
      }
      const askText = report
        ? `All set! I finished job ${job.jobId}.`
        : planMissing
          ? `I need a few clarifications before I can produce the plan for job ${job.jobId}.`
          : job.type === 'REVIEW'
            ? `All set! I finished job ${job.jobId}, but no review report was produced.`
            : `All set! I finished job ${job.jobId}, but no plan artifact was produced.`;
      const rendered = channelAdapter.renderCompletionMessage({
        botName: config.botName,
        text: askText,
        jobId: job.jobId,
        ...(openQuestions.length ? { openQuestions } : {}),
      });
      await notifier.postMessage(channelRef, rendered.text, rendered.options);
      const summary = report ? report.slice(0, 500) : `${job.type} complete`;
      await registry
        .updateJobRecord(job.jobId, {
          status: 'ok',
          summary,
        })
        .catch((err) => {
          logger.warn({ err, jobId: job.jobId }, 'Failed to mark job as ok');
        });
      return {
        jobId: job.jobId,
        status: 'ok',
        summary,
        ...(report ? { reportPath } : {}),
      };
    }

    const summary = await readJobSummary(paths);

    const mergeRequests: MergeRequestResult[] = [];
    const localBranchMessages: string[] = [];

    for (const [repoKey, repo] of repoWorktrees.entries()) {
      const repoConfig = config.repoAllowlist[repoKey];
      if (!repoConfig) {
        throw new Error(`Repo ${repoKey} is not in allowlist.`);
      }
      await runRepoChecks(
        repo.worktreePath,
        job.settings?.checks,
        env,
        paths.logFile,
        redactionPatterns,
      );

      if (!repo.branch) {
        continue;
      }

      const committed = await commitRepoChanges(
        repo.worktreePath,
        repo.branch,
        job.jobId,
        config.botName,
        env,
        paths.logFile,
        redactionPatterns,
      );
      if (!committed) {
        continue;
      }

      const title = `${config.botName}: ${job.requestText.slice(0, 60)}`;
      const description = config.includeRawRequestInMr
        ? buildMergeRequestDescription(summary, job.requestText, config.botName, job.jobId)
        : summary || `${config.botName} job ${job.jobId}`;
      const reviewers = job.settings?.reviewers?.map((reviewer) => reviewer.trim()).filter(Boolean);

      if (repoConfig.localPath) {
        localBranchMessages.push(
          `${repoKey}: local branch created at ${repoConfig.localPath} (${repo.branch})`,
        );
        continue;
      }

      if (!repoConfig.sshUrl) {
        throw new Error(`Missing sshUrl for repo ${repoKey}.`);
      }

      const providerId = inferRepoProvider(repoConfig);
      const reviewRequest = await createRepoReviewRequest({
        providerId,
        repo: repoConfig,
        context: {
          ...(config.github ? { github: config.github } : {}),
          ...(config.gitlab ? { gitlab: config.gitlab } : {}),
        },
        input: {
          head: repo.branch,
          base: job.gitRef,
          title,
          description,
          ...(job.settings?.labels ? { labels: job.settings.labels } : {}),
          ...(reviewers && reviewers.length ? { reviewers } : {}),
        },
      });
      mergeRequests.push({ repoKey, url: reviewRequest.url, iid: reviewRequest.iid });
    }

    const mrTextParts: string[] = [];
    if (mergeRequests.length) {
      mrTextParts.push(mergeRequests.map((mr) => `${mr.repoKey}: ${mr.url}`).join('\n'));
    }
    if (localBranchMessages.length) {
      mrTextParts.push(localBranchMessages.join('\n'));
    }
    const mrText = mrTextParts.length ? mrTextParts.join('\n') : 'No merge requests created.';

    const threadId = await resolveThreadId(job, registry);
    const channelRef = buildChannelRef(job, threadId);
    await notifier.uploadFile(channelRef, {
      fileContent: summary,
      title: `sniptail-${job.jobId}-summary.md`,
    });

    const implText = `All set! I finished job ${job.jobId}.\n${mrText}`;
    const includeReviewFromJob = Object.keys(branchByRepo).length > 0;
    const rendered = channelAdapter.renderCompletionMessage({
      botName: config.botName,
      text: implText,
      jobId: job.jobId,
      includeReviewFromJob,
    });
    await notifier.postMessage(channelRef, rendered.text, rendered.options);

    await registry
      .updateJobRecord(job.jobId, {
        status: 'ok',
        summary: summary || 'IMPLEMENT complete',
        mergeRequests,
      })
      .catch((err) => {
        logger.warn({ err, jobId: job.jobId }, 'Failed to mark job as ok');
      });
    return {
      jobId: job.jobId,
      status: 'ok',
      summary: summary || 'IMPLEMENT complete',
      mergeRequests,
    };
  } catch (err) {
    logger.error({ err, jobId: job.jobId }, 'Job failed');
    const threadId = await resolveThreadId(job, registry);
    const channelRef = buildChannelRef(job, threadId);
    await notifier.postMessage(
      channelRef,
      `I hit an issue with job ${job.jobId}: ${(err as Error).message}`,
    );
    await registry
      .updateJobRecord(job.jobId, {
        status: 'failed',
        error: (err as Error).message,
      })
      .catch((updateErr) => {
        logger.warn({ err: updateErr, jobId: job.jobId }, 'Failed to mark job as failed');
      });
    return {
      jobId: job.jobId,
      status: 'failed',
      summary: (err as Error).message,
    };
  } finally {
    // for (const repo of repoWorktrees.values()) {
    //   await removeWorktree({
    //     clonePath: repo.clonePath,
    //     worktreePath: repo.worktreePath,
    //     logFilePath: paths.logFile,
    //     env: {
    //       ...process.env,
    //       ...(config.openAiKey ? { OPENAI_API_KEY: config.openAiKey } : {}),
    //     },
    //     redact: redactionPatterns,
    //   });
    // }
    // await rm(paths.root, { recursive: true, force: true });
    await enforceJobCleanup(registry).catch((err) => {
      logger.warn({ err, jobId: job.jobId }, 'Failed to enforce job cleanup');
    });
  }
}
