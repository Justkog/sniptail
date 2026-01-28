import { join } from 'node:path';
import type { Queue } from 'bullmq';
import { loadWorkerConfig } from '@sniptail/core/config/config.js';
import { buildJobPaths, parseReviewerIds, validateJob } from '@sniptail/core/jobs/utils.js';
import { loadJobRecord, updateJobRecord } from '@sniptail/core/jobs/registry.js';
import { logger } from '@sniptail/core/logger.js';
import { buildSlackIds } from '@sniptail/core/slack/ids.js';
import type { BotEvent } from '@sniptail/core/types/bot-event.js';
import type { ChannelRef } from '@sniptail/core/types/channel.js';
import type { JobResult, MergeRequestResult, JobSpec } from '@sniptail/core/types/job.js';
import { isGitHubSshUrl } from '@sniptail/core/git/ssh.js';
import { buildMergeRequestDescription } from '../merge-requests/description.js';
import { createGitHubPullRequest } from '../merge-requests/github.js';
import { createGitLabMergeRequest } from '../merge-requests/gitlab.js';
import { createNotifier } from '../channels/createNotifier.js';
import { buildSlackCompletionPayload } from '../slack/completion.js';
import {
  copyJobRootSeed,
  ensureJobDirectories,
  readJobReport,
  readJobSummary,
  writeJobSpecArtifact,
} from './artifacts.js';
import { resolveThreadId } from './records.js';
import { prepareRepoWorktrees } from '../repos/worktrees.js';
import { ensureRepoClean, runRepoChecks } from '../repos/checks.js';
import { commitRepoChanges } from '../repos/commit.js';
import { runAgentJob } from '../agents/runAgent.js';

const config = loadWorkerConfig();
const branchPrefix = 'sniptail';

function buildChannelRef(job: JobSpec, threadId?: string): ChannelRef {
  return {
    provider: job.channel.provider,
    channelId: job.channel.channelId,
    ...(threadId ? { threadId } : {}),
  };
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

export async function runJob(botQueue: Queue<BotEvent>, job: JobSpec): Promise<JobResult> {
  validateJob(job);
  const notifier = createNotifier(botQueue);

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

    if (job.type === 'ASK') {
      const report = await readJobReport(paths);
      for (const repo of repoWorktrees.values()) {
        await ensureRepoClean(repo.worktreePath, env, paths.logFile, redactionPatterns);
      }
      const reportPath = join(paths.artifactsRoot, 'report.md');
      const threadId = await resolveThreadId(job);
      const channelRef = buildChannelRef(job, threadId);
      await notifier.uploadFile(channelRef, {
        filePath: reportPath,
        title: `sniptail-${job.jobId}-report.md`,
      });
      const askText = `All set! I finished job ${job.jobId}.`;
      if (job.channel.provider === 'slack') {
        const slackIds = buildSlackIds(config.botName);
        const askMessage = buildSlackCompletionPayload(askText, job.jobId, slackIds);
        await notifier.postMessage(channelRef, askMessage.text, { blocks: askMessage.blocks });
      } else {
        await notifier.postMessage(channelRef, askText);
      }
      await updateJobRecord(job.jobId, {
        status: 'ok',
        summary: report.slice(0, 500),
      }).catch((err) => {
        logger.warn({ err, jobId: job.jobId }, 'Failed to mark job as ok');
      });
      return {
        jobId: job.jobId,
        status: 'ok',
        summary: report.slice(0, 500),
        reportPath,
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
    if (job.channel.provider === 'slack') {
      const slackIds = buildSlackIds(config.botName);
      const implMessage = buildSlackCompletionPayload(implText, job.jobId, slackIds);
      await notifier.postMessage(channelRef, implMessage.text, { blocks: implMessage.blocks });
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
  }
}
