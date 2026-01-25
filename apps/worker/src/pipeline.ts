import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import type { Queue } from 'bullmq';
import { loadWorkerConfig } from '@sniptail/core/config/index.js';
import { runCodex } from '@sniptail/core/codex/index.js';
import { formatCodexEvent, summarizeCodexEvent } from '@sniptail/core/codex/logging.js';
import { createPullRequest } from '@sniptail/core/github/client.js';
import { createMergeRequest } from '@sniptail/core/gitlab/client.js';
import { commitAndPush, ensureCleanRepo, runChecks } from '@sniptail/core/git/jobOps.js';
import { ensureClone } from '@sniptail/core/git/mirror.js';
import { addWorktree } from '@sniptail/core/git/worktree.js';
import {
  findLatestJobBySlackThread,
  findLatestJobBySlackThreadAndTypes,
  loadJobRecord,
  updateJobRecord,
} from '@sniptail/core/jobs/registry.js';
import { buildJobPaths, parseReviewerIds, validateJob } from '@sniptail/core/jobs/utils.js';
import { logger } from '@sniptail/core/logger.js';
import { buildCompletionBlocks } from '@sniptail/core/slack/blocks.js';
import { buildSlackIds } from '@sniptail/core/slack/ids.js';
import type { BotEvent } from '@sniptail/core/types/bot-event.js';
import type { JobSpec, JobResult, MergeRequestResult } from '@sniptail/core/types/job.js';
import { join } from 'node:path';
import { runCommand } from '@sniptail/core/runner/commandRunner.js';
import { isGitHubSshUrl, parseGitHubRepo } from '@sniptail/core/git/ssh.js';
import { sendBotEvent } from './botEvents.js';

const config = loadWorkerConfig();

const branchPrefix = 'sniptail';

export async function copyJobRootSeed(
  jobRootCopyGlob: string | undefined,
  jobRootPath: string,
  env: NodeJS.ProcessEnv,
  logFile: string,
  redact: Array<string | RegExp>,
): Promise<void> {
  const trimmed = jobRootCopyGlob?.trim();
  if (!trimmed) return;
  const script = [
    'set -euo pipefail',
    'shopt -s nullglob',
    'matches=( $JOB_ROOT_COPY_GLOB )',
    'if (( ${#matches[@]} == 0 )); then',
    '  echo "No matches for JOB_ROOT_COPY_GLOB=$JOB_ROOT_COPY_GLOB"',
    '  exit 0',
    'fi',
    'for match in "${matches[@]}"; do',
    '  if [[ -d "$match" ]]; then',
    '    cp -R -- "$match/." "$JOB_ROOT_DEST"/',
    '  else',
    '    cp -R -- "$match" "$JOB_ROOT_DEST"/',
    '  fi',
    'done',
  ].join('\n');

  await runCommand('bash', ['-lc', script], {
    cwd: jobRootPath,
    env: { ...env, JOB_ROOT_COPY_GLOB: trimmed, JOB_ROOT_DEST: jobRootPath },
    logFilePath: logFile,
    timeoutMs: 60_000,
    redact,
  });
}

async function resolveThreadTs(job: JobSpec): Promise<string | undefined> {
  try {
    const record = await loadJobRecord(job.jobId);
    return record?.job?.slack?.threadTs ?? job.slack.threadTs;
  } catch (err) {
    logger.warn({ err, jobId: job.jobId }, 'Failed to resolve job thread timestamp');
    return job.slack.threadTs;
  }
}

function buildCodeFence(content: string): { open: string; close: string } {
  const matches = content.match(/`+/g);
  const maxBackticks = matches ? Math.max(...matches.map((match) => match.length)) : 0;
  const fence = '`'.repeat(Math.max(3, maxBackticks + 1));
  return { open: `${fence}text`, close: fence };
}

function buildMergeRequestDescription(
  summary: string,
  requestText: string,
  botName: string,
  jobId: string,
): string {
  const trimmedRequest = requestText.trim();
  const trimmedSummary = summary.trim();
  const baseSummary = trimmedSummary || `${botName} job ${jobId}`;
  if (!trimmedRequest) {
    return baseSummary;
  }
  const fence = buildCodeFence(trimmedRequest);
  return ['User request (raw):', fence.open, trimmedRequest, fence.close, '', baseSummary].join(
    '\n',
  );
}

export async function resolveCodexThreadId(job: JobSpec): Promise<string | undefined> {
  if (job.codexThreadId) {
    return job.codexThreadId;
  }
  if (job.resumeFromJobId) {
    try {
      const record = await loadJobRecord(job.resumeFromJobId);
      if (record?.job?.codexThreadId) {
        return record.job.codexThreadId;
      }
    } catch (err) {
      logger.warn({ err, jobId: job.jobId }, 'Failed to resolve Codex thread id from resumed job');
    }
  }
  const threadTs = await resolveThreadTs(job);
  if (!threadTs) return undefined;
  try {
    const record = await findLatestJobBySlackThread(job.slack.channelId, threadTs);
    return record?.job?.codexThreadId;
  } catch (err) {
    logger.warn({ err, jobId: job.jobId }, 'Failed to resolve Codex thread id');
    return undefined;
  }
}

export async function resolveMentionWorkingDirectory(
  job: JobSpec,
  fallback: string,
): Promise<string> {
  if (job.type !== 'MENTION') return fallback;
  const threadTs = await resolveThreadTs(job);
  if (!threadTs) return fallback;
  try {
    const record = await findLatestJobBySlackThreadAndTypes(job.slack.channelId, threadTs, [
      'ASK',
      'IMPLEMENT',
    ]);
    if (!record) return fallback;
    return buildJobPaths(record.job.jobId).root;
  } catch (err) {
    logger.warn({ err, jobId: job.jobId }, 'Failed to resolve working directory from previous job');
    return fallback;
  }
}

export async function runJob(botQueue: Queue<BotEvent>, job: JobSpec): Promise<JobResult> {
  validateJob(job);
  const slackIds = buildSlackIds(config.botName);

  await updateJobRecord(job.jobId, { status: 'running' }).catch((err) => {
    logger.warn({ err, jobId: job.jobId }, 'Failed to mark job as running');
  });

  const paths = buildJobPaths(job.jobId);
  await mkdir(paths.reposRoot, { recursive: true });
  await mkdir(paths.artifactsRoot, { recursive: true });
  await mkdir(paths.logsRoot, { recursive: true });
  const jobSpecPath = join(paths.artifactsRoot, 'job-spec.json');
  await writeFile(jobSpecPath, `${JSON.stringify(job, null, 2)}\n`, 'utf8').catch((err) => {
    logger.warn({ err, jobId: job.jobId }, 'Failed to write job spec artifact');
  });

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

  const repoWorktrees = new Map<
    string,
    { clonePath: string; worktreePath: string; branch?: string }
  >();
  const branchByRepo: Record<string, string> = {};
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
    for (const repoKey of job.repoKeys) {
      const repoConfig = config.repoAllowlist[repoKey];
      if (!repoConfig) {
        throw new Error(`Repo ${repoKey} is not in allowlist.`);
      }
      const clonePath = join(config.repoCacheRoot, `${repoKey}.git`);
      const worktreePath = join(paths.reposRoot, repoKey);
      const resumeBranch = resumeRecord?.branchByRepo?.[repoKey];
      const baseRef = resumeRecord
        ? (resumeBranch ?? `${branchPrefix}/${job.resumeFromJobId}`)
        : job.gitRef;
      const branch =
        job.type === 'IMPLEMENT' || job.type === 'ASK' ? `${branchPrefix}/${job.jobId}` : undefined;

      await ensureClone(
        repoKey,
        repoConfig,
        clonePath,
        paths.logFile,
        env,
        baseRef,
        redactionPatterns,
      );
      await addWorktree({
        clonePath,
        worktreePath,
        baseRef,
        ...(branch ? { branch } : {}),
        logFilePath: paths.logFile,
        env,
        redact: redactionPatterns,
      });
      repoWorktrees.set(repoKey, { clonePath, worktreePath, ...(branch ? { branch } : {}) });
      if (branch) {
        branchByRepo[repoKey] = branch;
      }
    }

    if (Object.keys(branchByRepo).length) {
      await updateJobRecord(job.jobId, { branchByRepo }).catch((err) => {
        logger.warn({ err, jobId: job.jobId }, 'Failed to record job branches');
      });
    }

    logger.info({ jobId: job.jobId, repoKeys: job.repoKeys }, 'Running Codex');

    const codexThreadId = await resolveCodexThreadId(job);
    const mentionWorkDir = await resolveMentionWorkingDirectory(job, config.repoCacheRoot);
    const codexResult = await runCodex(
      job,
      job.type === 'MENTION' ? mentionWorkDir : paths.root,
      env,
      {
        botName: config.botName,
        ...(codexThreadId ? { resumeThreadId: codexThreadId } : {}),
        onEvent: async (event) => {
          try {
            await appendFile(paths.logFile, formatCodexEvent(event));
          } catch (err) {
            logger.warn({ err }, 'Failed to append Codex event to log');
          }

          const summary = summarizeCodexEvent(event);
          if (!summary) return;

          if (summary.isError) {
            logger.error({ jobId: job.jobId }, summary.text);
          } else {
            logger.info({ jobId: job.jobId }, summary.text);
          }
        },
        ...(config.codex.executionMode === 'docker'
          ? {
              docker: {
                enabled: true,
                ...(config.codex.dockerfilePath && { dockerfilePath: config.codex.dockerfilePath }),
                ...(config.codex.dockerImage && { image: config.codex.dockerImage }),
                ...(config.codex.dockerBuildContext && {
                  buildContext: config.codex.dockerBuildContext,
                }),
              },
            }
          : {}),
        ...(job.type === 'MENTION'
          ? {
              sandboxMode: 'read-only' as const,
              approvalPolicy: 'on-request' as const,
            }
          : {}),
      },
    );
    if (codexResult.threadId) {
      const existingRecord = await loadJobRecord(job.jobId).catch((err) => {
        logger.warn(
          { err, jobId: job.jobId },
          'Failed to load job record for Codex thread id update',
        );
        return undefined;
      });
      const existingJob = existingRecord?.job ?? job;
      await updateJobRecord(job.jobId, {
        job: {
          ...existingJob,
          codexThreadId: codexResult.threadId,
        },
      }).catch((err) => {
        logger.warn({ err, jobId: job.jobId }, 'Failed to record Codex thread id');
      });
    }

    if (job.type === 'MENTION') {
      const replyText = codexResult.finalResponse || 'Thanks for the mention! How can I help?';
      const threadTs = await resolveThreadTs(job);
      await sendBotEvent(botQueue, {
        type: 'postMessage',
        jobId: job.jobId,
        payload: threadTs
          ? { channel: job.slack.channelId, text: replyText, threadTs }
          : { channel: job.slack.channelId, text: replyText },
      });
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
      const reportPath = join(paths.artifactsRoot, 'report.md');
      const report = await readFile(reportPath, 'utf8');
      for (const repo of repoWorktrees.values()) {
        await ensureCleanRepo(repo.worktreePath, env, paths.logFile, redactionPatterns);
      }
      const reportOptions = {
        channel: job.slack.channelId,
        filePath: reportPath,
        title: `sniptail-${job.jobId}-report.md`,
      };
      const threadTs = await resolveThreadTs(job);
      await sendBotEvent(botQueue, {
        type: 'uploadFile',
        jobId: job.jobId,
        payload: threadTs ? { ...reportOptions, threadTs } : reportOptions,
      });
      const askText = `All set! I finished job ${job.jobId}.`;
      const askMessage = {
        channel: job.slack.channelId,
        text: askText,
        blocks: buildCompletionBlocks(askText, job.jobId, slackIds.actions),
      };
      await sendBotEvent(botQueue, {
        type: 'postMessage',
        jobId: job.jobId,
        payload: threadTs ? { ...askMessage, threadTs } : askMessage,
      });
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

    const summaryPath = join(paths.artifactsRoot, 'summary.md');
    const summary = await readFile(summaryPath, 'utf8');

    const mergeRequests: MergeRequestResult[] = [];
    const localBranchMessages: string[] = [];

    for (const [repoKey, repo] of repoWorktrees.entries()) {
      const repoConfig = config.repoAllowlist[repoKey];
      if (!repoConfig) {
        throw new Error(`Repo ${repoKey} is not in allowlist.`);
      }
      await runChecks(
        repo.worktreePath,
        job.settings?.checks,
        env,
        paths.logFile,
        redactionPatterns,
      );

      if (!repo.branch) {
        continue;
      }

      const committed = await commitAndPush(
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

      const mr = isGitHubSshUrl(repoConfig.sshUrl)
        ? await (async () => {
            if (!config.github) {
              throw new Error('GITHUB_TOKEN is required to create GitHub pull requests.');
            }
            const repoInfo = parseGitHubRepo(repoConfig.sshUrl!);
            if (!repoInfo) {
              throw new Error(`Unable to parse GitHub repo from sshUrl: ${repoConfig.sshUrl}`);
            }
            const pr = await createPullRequest({
              config: config.github,
              owner: repoInfo.owner,
              repo: repoInfo.repo,
              head: repo.branch!,
              base: job.gitRef,
              title,
              body: description,
              ...(job.settings?.labels ? { labels: job.settings.labels } : {}),
              ...(reviewers && reviewers.length ? { reviewers } : {}),
            });
            return {
              url: pr.url,
              iid: pr.number,
            };
          })()
        : await (async () => {
            if (!repoConfig.projectId) {
              throw new Error(`Missing projectId for GitLab repo ${repoKey}.`);
            }
            if (!config.gitlab) {
              throw new Error(
                'GITLAB_BASE_URL and GITLAB_TOKEN are required to create GitLab merge requests.',
              );
            }
            const reviewerIds = parseReviewerIds(job.settings?.reviewers);
            const gitlabMr = await createMergeRequest({
              config: config.gitlab,
              projectId: repoConfig.projectId,
              sourceBranch: repo.branch!,
              targetBranch: job.gitRef,
              title,
              description,
              ...(job.settings?.labels ? { labels: job.settings.labels } : {}),
              ...(reviewerIds ? { reviewerIds } : {}),
            });
            return {
              url: gitlabMr.url,
              iid: gitlabMr.iid,
            };
          })();

      mergeRequests.push({
        repoKey,
        url: mr.url,
        iid: mr.iid,
      });
    }

    const mrTextParts: string[] = [];
    if (mergeRequests.length) {
      mrTextParts.push(mergeRequests.map((mr) => `${mr.repoKey}: ${mr.url}`).join('\n'));
    }
    if (localBranchMessages.length) {
      mrTextParts.push(localBranchMessages.join('\n'));
    }
    const mrText = mrTextParts.length ? mrTextParts.join('\n') : 'No merge requests created.';

    const threadTs = await resolveThreadTs(job);
    const summaryOptions = {
      channel: job.slack.channelId,
      filePath: summaryPath,
      title: `sniptail-${job.jobId}-summary.md`,
    };
    await sendBotEvent(botQueue, {
      type: 'uploadFile',
      jobId: job.jobId,
      payload: threadTs ? { ...summaryOptions, threadTs } : summaryOptions,
    });

    const implText = `All set! I finished job ${job.jobId}.\n${mrText}`;
    const implMessage = {
      channel: job.slack.channelId,
      text: implText,
      blocks: buildCompletionBlocks(implText, job.jobId, slackIds.actions),
    };
    await sendBotEvent(botQueue, {
      type: 'postMessage',
      jobId: job.jobId,
      payload: threadTs ? { ...implMessage, threadTs } : implMessage,
    });

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
    const failMessage = {
      channel: job.slack.channelId,
      text: `I hit an issue with job ${job.jobId}: ${(err as Error).message}`,
    };
    const threadTs = await resolveThreadTs(job);
    await sendBotEvent(botQueue, {
      type: 'postMessage',
      jobId: job.jobId,
      payload: threadTs ? { ...failMessage, threadTs } : failMessage,
    });
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
