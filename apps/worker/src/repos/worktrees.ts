import { join } from 'node:path';
import type { JobSpec } from '@sniptail/core/types/job.js';
import type { JobRecord } from '@sniptail/core/jobs/registry.js';
import { buildLegacyJobBranch } from '@sniptail/core/git/branch.js';
import { ensureClone } from '@sniptail/core/git/mirror.js';
import { runSetupContract } from '@sniptail/core/git/jobOps.js';
import { addWorktree } from '@sniptail/core/git/worktree.js';
import type { loadWorkerConfig } from '@sniptail/core/config/config.js';
import type { buildJobPaths } from '@sniptail/core/jobs/utils.js';

export type RepoWorktree = {
  clonePath: string;
  worktreePath: string;
  branch?: string;
};

export type RepoWorktreeMap = Map<string, RepoWorktree>;

type WorkerConfig = ReturnType<typeof loadWorkerConfig>;
type JobPaths = ReturnType<typeof buildJobPaths>;

type PrepareRepoWorktreesOptions = {
  job: JobSpec;
  config: WorkerConfig;
  paths: JobPaths;
  env: NodeJS.ProcessEnv;
  redactionPatterns: Array<string | RegExp>;
  resumeRecord?: JobRecord;
  branchPrefix: string;
};

export async function prepareRepoWorktrees(
  options: PrepareRepoWorktreesOptions,
): Promise<{ repoWorktrees: RepoWorktreeMap; branchByRepo: Record<string, string> }> {
  const { job, config, paths, env, redactionPatterns, resumeRecord, branchPrefix } = options;

  const repoWorktrees: RepoWorktreeMap = new Map();
  const branchByRepo: Record<string, string> = {};

  for (const repoKey of job.repoKeys) {
    const repoConfig = config.repoAllowlist[repoKey];
    if (!repoConfig) {
      throw new Error(`Repo ${repoKey} is not in allowlist.`);
    }
    const clonePath = join(config.repoCacheRoot, `${repoKey}.git`);
    const worktreePath = join(paths.reposRoot, repoKey);
    const resumeBranch = resumeRecord?.branchByRepo?.[repoKey];
    const mentionBaseRef = repoConfig.baseBranch?.trim() || job.gitRef;
    const baseRef = resumeRecord
      ? (resumeBranch ?? `${branchPrefix}/${job.resumeFromJobId}`)
      : job.type === 'MENTION'
        ? mentionBaseRef
        : job.gitRef;
    const branch =
      job.type === 'IMPLEMENT' ||
      job.type === 'ASK' ||
      job.type === 'EXPLORE' ||
      job.type === 'PLAN' ||
      job.type === 'RUN'
        ? `${branchPrefix}/${job.jobId}`
        : undefined;
    let resolvedBaseRef = baseRef;

    try {
      await ensureClone(
        repoKey,
        repoConfig,
        clonePath,
        paths.logFile,
        env,
        baseRef,
        redactionPatterns,
        {
          checkoutRef: !resumeRecord,
          forceLocalBranchUpdate: !resumeRecord,
        },
      );
    } catch (err) {
      if (
        !resumeRecord ||
        resumeBranch ||
        !job.resumeFromJobId ||
        !(err instanceof Error) ||
        !err.message.includes(`Branch not found in clone: ${baseRef}`)
      ) {
        throw err;
      }

      const legacyResumeBranch = buildLegacyJobBranch(job.resumeFromJobId);
      if (legacyResumeBranch === baseRef) {
        throw err;
      }

      await ensureClone(
        repoKey,
        repoConfig,
        clonePath,
        paths.logFile,
        env,
        legacyResumeBranch,
        redactionPatterns,
        {
          checkoutRef: !resumeRecord,
          forceLocalBranchUpdate: !resumeRecord,
        },
      );
      resolvedBaseRef = legacyResumeBranch;
    }
    await addWorktree({
      clonePath,
      worktreePath,
      baseRef: resolvedBaseRef,
      ...(config.worktreeSetupCommand ? { setupCommand: config.worktreeSetupCommand } : {}),
      ...(config.worktreeSetupAllowFailure !== undefined
        ? { setupAllowFailure: config.worktreeSetupAllowFailure }
        : {}),
      ...(branch ? { branch } : {}),
      logFilePath: paths.logFile,
      env,
      redact: redactionPatterns,
    });
    await runSetupContract(worktreePath, env, paths.logFile, redactionPatterns);
    repoWorktrees.set(repoKey, { clonePath, worktreePath, ...(branch ? { branch } : {}) });
    if (branch) {
      branchByRepo[repoKey] = branch;
    }
  }

  return { repoWorktrees, branchByRepo };
}
