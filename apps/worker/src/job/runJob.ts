import { join } from 'node:path';
import { loadWorkerConfig } from '@sniptail/core/config/config.js';
import { buildJobPaths, parseReviewerIds, validateJob } from '@sniptail/core/jobs/utils.js';
import { loadJobRecord, updateJobRecord } from '@sniptail/core/jobs/registry.js';
import { logger } from '@sniptail/core/logger.js';
import { buildSlackIds } from '@sniptail/core/slack/ids.js';
import { buildDiscordCompletionComponents } from '@sniptail/core/discord/components.js';
import type { ChannelRef } from '@sniptail/core/types/channel.js';
import type { JobResult, MergeRequestResult, JobSpec } from '@sniptail/core/types/job.js';
import { isGitHubSshUrl } from '@sniptail/core/git/ssh.js';
import { buildMergeRequestDescription } from '../merge-requests/description.js';
import { createGitHubPullRequest } from '../merge-requests/github.js';
import { createGitLabMergeRequest } from '../merge-requests/gitlab.js';
import type { BotEventSink } from '../channels/botEventSink.js';
import { createNotifier } from '../channels/createNotifier.js';
import { buildCompletionBlocks } from '@sniptail/core/slack/blocks.js';
import {
  copyJobRootSeed,
  ensureJobDirectories,
  readJobPlan,
  readJobReport,
  readJobSummary,
  writeJobSpecArtifact,
} from './artifacts.js';
import { resolveThreadId } from './records.js';
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

async function recordAgentThreadId(job: JobSpec, agentId: string, threadId: string): Promise<void> {
  const existingRecord = await loadJobRecord(job.jobId).catch((err) => {
    logger.warn({ err, jobId: job.jobId }, 'Failed to load job record for agent thread id update');
    return undefined;
  });
  const existingJob = existingRecord?.job ?? job;
  await updateJobRecord(job.jobId, {
    job: {
      ...existingJob,
      agentThreadIds: {
        ...(existingJob.agentThreadIds ?? {}),
        [agentId]: threadId,
      },
    },
  }).catch((err) => {
    logger.warn({ err, jobId: job.jobId }, 'Failed to record agent thread id');
  });
}

export async function runJob(events: BotEventSink, job: JobSpec): Promise<JobResult> {
  validateJob(job);
  const notifier = createNotifier(events);

  await updateJobRecord(job.jobId, { status: 'running' }).catch((err) => {
    logger.warn({ err, jobId: job.jobId }, 'Failed to mark job as running');
  });

  const paths = buildJobPaths(job.jobId);
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

  const resumeRecord = job.resumeFromJobId ? await loadJobRecord(job.resumeFromJobId) : null;
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
      await updateJobRecord(job.jobId, { branchByRepo }).catch((err) => {
        logger.warn({ err, jobId: job.jobId }, 'Failed to record job branches');
      });
    }

    const agentRun = await runAgentJob({ job, config, paths, env });

    if (agentRun.result.threadId) {
      await recordAgentThreadId(job, agentRun.agentId, agentRun.result.threadId);
    }

    if (job.type === 'MENTION') {
      const replyText = agentRun.result.finalResponse || 'Thanks for the mention! How can I help?';
      const threadId = await resolveThreadId(job);
      const channelRef = buildChannelRef(job, threadId);
      await notifier.postMessage(channelRef, replyText);
      await updateJobRecord(job.jobId, {
        status: 'ok',
        summary: replyText.slice(0, 500),
      }).catch((err) => {
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
        await updateJobRecord(job.jobId, { openQuestions }).catch((err) => {
          logger.warn({ err, jobId: job.jobId }, 'Failed to persist open questions');
        });
      }
      for (const repo of repoWorktrees.values()) {
        await ensureRepoClean(repo.worktreePath, env, paths.logFile, redactionPatterns);
      }
      const threadId = await resolveThreadId(job);
      const channelRef = buildChannelRef(job, threadId);
      if (report) {
        await notifier.uploadFile(channelRef, {
          filePath: reportPath,
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
      if (job.channel.provider === 'slack') {
        const slackIds = buildSlackIds(config.botName);
        const blocks = buildCompletionBlocks(
          askText,
          job.jobId,
          {
            askFromJob: slackIds.actions.askFromJob,
            implementFromJob: slackIds.actions.implementFromJob,
            reviewFromJob: slackIds.actions.reviewFromJob,
            worktreeCommands: slackIds.actions.worktreeCommands,
            clearJob: slackIds.actions.clearJob,
            ...(openQuestions.length ? { answerQuestions: slackIds.actions.answerQuestions } : {}),
          },
          openQuestions.length
            ? {
                includeAskFromJob: false,
                includeImplementFromJob: false,
                includeReviewFromJob: false,
                answerQuestionsFirst: true,
              }
            : undefined,
        );
        await notifier.postMessage(channelRef, askText, { blocks });
      } else if (job.channel.provider === 'discord') {
        const components = buildDiscordCompletionComponents(job.jobId, {
          includeAnswerQuestions: openQuestions.length > 0,
          includeAskFromJob: !openQuestions.length,
          includeImplementFromJob: !openQuestions.length,
          includeReviewFromJob: false,
          answerQuestionsFirst: openQuestions.length > 0,
        });
        await notifier.postMessage(channelRef, askText, { components });
      } else {
        await notifier.postMessage(channelRef, askText);
      }
      const summary = report ? report.slice(0, 500) : `${job.type} complete`;
      await updateJobRecord(job.jobId, {
        status: 'ok',
        summary,
      }).catch((err) => {
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

      if (isGitHubSshUrl(repoConfig.sshUrl)) {
        if (!config.github) {
          throw new Error('GITHUB_API_TOKEN is required to create GitHub pull requests.');
        }
        const pr = await createGitHubPullRequest({
          config: config.github,
          sshUrl: repoConfig.sshUrl,
          head: repo.branch,
          base: job.gitRef,
          title,
          body: description,
          ...(job.settings?.labels ? { labels: job.settings.labels } : {}),
          ...(reviewers && reviewers.length ? { reviewers } : {}),
        });
        mergeRequests.push({ repoKey, url: pr.url, iid: pr.iid });
        continue;
      }

      if (!repoConfig.projectId) {
        throw new Error(`Missing projectId for GitLab repo ${repoKey}.`);
      }
      if (!config.gitlab) {
        throw new Error(
          'GITLAB_BASE_URL and GITLAB_TOKEN are required to create GitLab merge requests.',
        );
      }

      const reviewerIds = parseReviewerIds(job.settings?.reviewers);
      const mr = await createGitLabMergeRequest({
        config: config.gitlab,
        projectId: repoConfig.projectId,
        sourceBranch: repo.branch,
        targetBranch: job.gitRef,
        title,
        description,
        ...(job.settings?.labels ? { labels: job.settings.labels } : {}),
        ...(reviewerIds ? { reviewerIds } : {}),
      });
      mergeRequests.push({ repoKey, url: mr.url, iid: mr.iid });
    }

    const mrTextParts: string[] = [];
    if (mergeRequests.length) {
      mrTextParts.push(mergeRequests.map((mr) => `${mr.repoKey}: ${mr.url}`).join('\n'));
    }
    if (localBranchMessages.length) {
      mrTextParts.push(localBranchMessages.join('\n'));
    }
    const mrText = mrTextParts.length ? mrTextParts.join('\n') : 'No merge requests created.';

    const summaryPath = join(paths.artifactsRoot, 'summary.md');
    const threadId = await resolveThreadId(job);
    const channelRef = buildChannelRef(job, threadId);
    await notifier.uploadFile(channelRef, {
      filePath: summaryPath,
      title: `sniptail-${job.jobId}-summary.md`,
    });

    const implText = `All set! I finished job ${job.jobId}.\n${mrText}`;
    const includeReviewFromJob = Object.keys(branchByRepo).length > 0;
    if (job.channel.provider === 'slack') {
      const slackIds = buildSlackIds(config.botName);
      const blocks = buildCompletionBlocks(
        implText,
        job.jobId,
        {
          askFromJob: slackIds.actions.askFromJob,
          implementFromJob: slackIds.actions.implementFromJob,
          reviewFromJob: slackIds.actions.reviewFromJob,
          worktreeCommands: slackIds.actions.worktreeCommands,
          clearJob: slackIds.actions.clearJob,
        },
        {
          includeReviewFromJob,
        },
      );
      await notifier.postMessage(channelRef, implText, { blocks });
    } else if (job.channel.provider === 'discord') {
      const components = buildDiscordCompletionComponents(job.jobId, {
        includeReviewFromJob,
      });
      await notifier.postMessage(channelRef, implText, { components });
    } else {
      await notifier.postMessage(channelRef, implText);
    }

    await updateJobRecord(job.jobId, {
      status: 'ok',
      summary: summary || 'IMPLEMENT complete',
      mergeRequests,
    }).catch((err) => {
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
    const threadId = await resolveThreadId(job);
    const channelRef = buildChannelRef(job, threadId);
    await notifier.postMessage(
      channelRef,
      `I hit an issue with job ${job.jobId}: ${(err as Error).message}`,
    );
    await updateJobRecord(job.jobId, {
      status: 'failed',
      error: (err as Error).message,
    }).catch((updateErr) => {
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
    await enforceJobCleanup().catch((err) => {
      logger.warn({ err, jobId: job.jobId }, 'Failed to enforce job cleanup');
    });
  }
}
