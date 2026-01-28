import { join } from 'node:path';
import type { JobSpec } from '@sniptail/core/types/job.js';
import type { JobRecord } from '@sniptail/core/jobs/registry.js';
import { ensureClone } from '@sniptail/core/git/mirror.js';
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

  return { repoWorktrees, branchByRepo };
}
