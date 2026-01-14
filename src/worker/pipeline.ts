import { appendFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { config } from '../config/index.js';
import { buildJobPaths, parseReviewerIds, validateJob } from '../jobs/utils.js';
import { logger } from '../logger.js';
import { ensureClone } from '../git/mirror.js';
import { addWorktree, removeWorktree } from '../git/worktree.js';
import { runCodex } from '../codex/index.js';
import { createPullRequest } from '../github/client.js';
import { createMergeRequest } from '../gitlab/client.js';
import { commitAndPush, ensureCleanRepo, runChecks } from '../git/jobOps.js';
import { buildCompletionBlocks } from '../slack/blocks.js';
import { buildSlackIds } from '../slack/ids.js';
import { postMessage, uploadFile } from '../slack/helpers.js';
import { findLatestJobBySlackThread, loadJobRecord, updateJobRecord } from '../jobs/registry.js';
import type { App } from '@slack/bolt';
import type { JobSpec, JobResult, MergeRequestResult } from '../types/job.js';
import { formatCodexEvent, summarizeCodexEvent } from '../codex/logging.js';
import { join } from 'node:path';
import { runCommand } from '../runner/commandRunner.js';
import { isGitHubSshUrl, parseGitHubRepo } from '../git/ssh.js';

const branchPrefix = 'sniptail';

async function copyJobRootSeed(
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

async function resolveCodexThreadId(job: JobSpec): Promise<string | undefined> {
  if (job.codexThreadId) {
    return job.codexThreadId;
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

export async function runJob(app: App, job: JobSpec): Promise<JobResult> {
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

  const redactionPatterns = [config.gitlab?.token ?? '', config.github?.token ?? '', config.openAiKey ?? ''].filter(Boolean);

  const repoWorktrees = new Map<string, { clonePath: string; worktreePath: string; branch?: string }>();
  const branchByRepo: Record<string, string> = {};
  const resumeRecord = job.resumeFromJobId ? await loadJobRecord(job.resumeFromJobId) : null;
  if (job.resumeFromJobId && !resumeRecord) {
    throw new Error(`Resume job not found: ${job.resumeFromJobId}`);
  }

  try {
    await copyJobRootSeed(config.jobRootCopyGlob, paths.root, env, paths.logFile, redactionPatterns);
    for (const repoKey of job.repoKeys) {
      const repoConfig = config.repoAllowlist[repoKey];
      if (!repoConfig) {
        throw new Error(`Repo ${repoKey} is not in allowlist.`);
      }
      const clonePath = join(config.repoCacheRoot, `${repoKey}.git`);
      const worktreePath = join(paths.reposRoot, repoKey);
      const resumeBranch = resumeRecord?.branchByRepo?.[repoKey];
      const baseRef = resumeRecord ? resumeBranch ?? `${branchPrefix}/${job.resumeFromJobId}` : job.gitRef;
      const branch = job.type === 'IMPLEMENT' || job.type === 'ASK' ? `${branchPrefix}/${job.jobId}` : undefined;

      await ensureClone(repoKey, repoConfig, clonePath, paths.logFile, env, baseRef, redactionPatterns);
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
    const codexResult = await runCodex(job, job.type === 'MENTION' ? config.repoCacheRoot : paths.root, env, {
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
              ...config.codex.dockerfilePath && { dockerfilePath: config.codex.dockerfilePath },
              ...config.codex.dockerImage && { image: config.codex.dockerImage },
              ...config.codex.dockerBuildContext && { buildContext: config.codex.dockerBuildContext },
            },
          }
        : {}),
      ...(job.type === 'MENTION'
        ? {
            sandboxMode: 'read-only' as const,
            approvalPolicy: 'on-request' as const,
          }
        : {}),
    });
    if (codexResult.threadId) {
      await updateJobRecord(job.jobId, {
        job: {
          ...job,
          codexThreadId: codexResult.threadId,
        },
      }).catch((err) => {
        logger.warn({ err, jobId: job.jobId }, 'Failed to record Codex thread id');
      });
    }

    if (job.type === 'MENTION') {
      const replyText = codexResult.finalResponse || 'Thanks for the mention! How can I help?';
      const threadTs = await resolveThreadTs(job);
      await postMessage(app, threadTs ? { channel: job.slack.channelId, text: replyText, threadTs } : {
        channel: job.slack.channelId,
        text: replyText,
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
      await uploadFile(
        app,
        threadTs ? { ...reportOptions, threadTs } : reportOptions,
      );
    const askText = `All set! I finished job ${job.jobId}.`;
    const askMessage = {
      channel: job.slack.channelId,
      text: askText,
      blocks: buildCompletionBlocks(askText, job.jobId, slackIds.actions),
    };
      await postMessage(app, threadTs ? { ...askMessage, threadTs } : askMessage);
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
      await runChecks(repo.worktreePath, job.settings?.checks, env, paths.logFile, redactionPatterns);

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
      const description = summary || `${config.botName} job ${job.jobId}`;
      const reviewers = job.settings?.reviewers?.map((reviewer) => reviewer.trim()).filter(Boolean);

      if (repoConfig.localPath) {
        localBranchMessages.push(`${repoKey}: local branch created at ${repoConfig.localPath} (${repo.branch})`);
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
            const repoInfo = parseGitHubRepo(repoConfig.sshUrl);
            if (!repoInfo) {
              throw new Error(`Unable to parse GitHub repo from sshUrl: ${repoConfig.sshUrl}`);
            }
            const pr = await createPullRequest({
              config: config.github,
              owner: repoInfo.owner,
              repo: repoInfo.repo,
              head: repo.branch,
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
              throw new Error('GITLAB_BASE_URL and GITLAB_TOKEN are required to create GitLab merge requests.');
            }
            const reviewerIds = parseReviewerIds(job.settings?.reviewers);
            const gitlabMr = await createMergeRequest({
              config: config.gitlab,
              projectId: repoConfig.projectId,
              sourceBranch: repo.branch,
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
    await uploadFile(
      app,
      threadTs
        ? {
            channel: job.slack.channelId,
            filePath: summaryPath,
            title: `sniptail-${job.jobId}-summary.md`,
            threadTs,
          }
        : {
            channel: job.slack.channelId,
            filePath: summaryPath,
            title: `sniptail-${job.jobId}-summary.md`,
          },
    );

    const implText = `All set! I finished job ${job.jobId}.\n${mrText}`;
    const implMessage = {
      channel: job.slack.channelId,
      text: implText,
      blocks: buildCompletionBlocks(implText, job.jobId, slackIds.actions),
    };
    await postMessage(app, threadTs ? { ...implMessage, threadTs } : implMessage);

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
    await postMessage(app, threadTs ? { ...failMessage, threadTs } : failMessage);
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
