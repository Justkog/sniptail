import { join } from 'node:path';
import type { LineagePromptWarning } from '@sniptail/core/agents/buildPrompt.js';
import { ensureClone } from '@sniptail/core/git/mirror.js';
import { resolveGitRef, runSetupContract } from '@sniptail/core/git/jobOps.js';
import { addWorktree } from '@sniptail/core/git/worktree.js';
import type { JobRecord } from '@sniptail/core/jobs/registry.js';
import type { loadWorkerConfig } from '@sniptail/core/config/config.js';
import type { buildJobPaths } from '@sniptail/core/jobs/utils.js';
import type { JobSpec } from '@sniptail/core/types/job.js';

export type RepoWorktree = {
  clonePath: string;
  worktreePath: string;
  originBranch: string;
  detached: boolean;
  expectedBaseTipSha: string;
  worktreeBranch?: string;
};

export type RepoWorktreeMap = Map<string, RepoWorktree>;

export type PreparedRepoLineage = {
  branchByRepo: Record<string, string>;
  originBranchByRepo: Record<string, string>;
  lineageTipShaByRepo: Record<string, string>;
  lineageBaseShaByRepo: Record<string, string>;
  lineageWarningByRepo: Record<string, string>;
  promptWarnings: LineagePromptWarning[];
};

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

function isBranchBackedJob(job: JobSpec): boolean {
  return (
    job.type === 'IMPLEMENT' ||
    job.type === 'ASK' ||
    job.type === 'EXPLORE' ||
    job.type === 'PLAN' ||
    job.type === 'RUN'
  );
}

async function resolveGitRefSha(
  repoPath: string,
  ref: string,
  env: NodeJS.ProcessEnv,
  logFile: string,
  redactionPatterns: Array<string | RegExp>,
): Promise<string | undefined> {
  return resolveGitRef(repoPath, ref, env, logFile, redactionPatterns);
}

function requireRecordMapValue(
  record: JobRecord,
  repoKey: string,
  fieldName: 'originBranchByRepo' | 'lineageTipShaByRepo' | 'lineageBaseShaByRepo',
): string {
  const map = record[fieldName];
  const value = map?.[repoKey]?.trim();
  if (!value) {
    throw new Error(
      `Resume job ${record.job.jobId} is missing required ${fieldName} metadata for repo ${repoKey}.`,
    );
  }
  return value;
}

function readRecordMapValue(
  record: JobRecord,
  repoKey: string,
  fieldName: 'originBranchByRepo' | 'lineageTipShaByRepo' | 'lineageBaseShaByRepo',
): string | undefined {
  const map = record[fieldName];
  const value = map?.[repoKey]?.trim();
  return value || undefined;
}

export async function prepareRepoWorktrees(
  options: PrepareRepoWorktreesOptions,
): Promise<{ repoWorktrees: RepoWorktreeMap; lineage: PreparedRepoLineage }> {
  const { job, config, paths, env, redactionPatterns, resumeRecord, branchPrefix } = options;

  const repoWorktrees: RepoWorktreeMap = new Map();
  const lineage: PreparedRepoLineage = {
    branchByRepo: {},
    originBranchByRepo: {},
    lineageTipShaByRepo: {},
    lineageBaseShaByRepo: {},
    lineageWarningByRepo: {},
    promptWarnings: [],
  };

  for (const repoKey of job.repoKeys) {
    const repoConfig = config.repoAllowlist[repoKey];
    if (!repoConfig) {
      throw new Error(`Repo ${repoKey} is not in allowlist.`);
    }

    const clonePath = join(config.repoCacheRoot, `${repoKey}.git`);
    const worktreePath = join(paths.reposRoot, repoKey);
    const mentionBaseRef = repoConfig.baseBranch?.trim() || job.gitRef;

    if (resumeRecord) {
      const originBranch = requireRecordMapValue(resumeRecord, repoKey, 'originBranchByRepo');
      const persistedTipSha = requireRecordMapValue(resumeRecord, repoKey, 'lineageTipShaByRepo');
      const persistedBaseSha = readRecordMapValue(resumeRecord, repoKey, 'lineageBaseShaByRepo');
      const fallbackBranch = isBranchBackedJob(job) ? `${branchPrefix}/${job.jobId}` : undefined;

      await ensureClone(
        repoKey,
        repoConfig,
        clonePath,
        paths.logFile,
        env,
        originBranch,
        redactionPatterns,
        {
          checkoutRef: false,
          forceLocalBranchUpdate: false,
        },
      );

      const remoteOriginTipSha = await resolveGitRefSha(
        clonePath,
        `refs/remotes/origin/${originBranch}`,
        env,
        paths.logFile,
        redactionPatterns,
      );
      const localOriginTipSha = await resolveGitRefSha(
        clonePath,
        `refs/heads/${originBranch}`,
        env,
        paths.logFile,
        redactionPatterns,
      );
      const currentOriginTipSha = remoteOriginTipSha ?? localOriginTipSha;
      if (!currentOriginTipSha) {
        throw new Error(`Origin branch missing for repo ${repoKey}: ${originBranch}`);
      }

      if (remoteOriginTipSha) {
        await addWorktree({
          clonePath,
          worktreePath,
          baseRef: currentOriginTipSha,
          ...(config.worktreeSetupCommand ? { setupCommand: config.worktreeSetupCommand } : {}),
          ...(config.worktreeSetupAllowFailure !== undefined
            ? { setupAllowFailure: config.worktreeSetupAllowFailure }
            : {}),
          logFilePath: paths.logFile,
          env,
          redact: redactionPatterns,
        });
        await runSetupContract(worktreePath, env, paths.logFile, redactionPatterns);

        repoWorktrees.set(repoKey, {
          clonePath,
          worktreePath,
          originBranch,
          detached: true,
          expectedBaseTipSha: currentOriginTipSha,
        });
        lineage.originBranchByRepo[repoKey] = originBranch;
        lineage.lineageBaseShaByRepo[repoKey] = currentOriginTipSha;
        lineage.lineageTipShaByRepo[repoKey] = currentOriginTipSha;

        if (persistedTipSha !== currentOriginTipSha) {
          lineage.lineageWarningByRepo[repoKey] =
            `Lineage branch ${originBranch} moved from ${persistedTipSha} to ${currentOriginTipSha}.`;
          lineage.promptWarnings.push({
            repoKey,
            originBranch,
            previousTipSha: persistedTipSha,
            currentTipSha: currentOriginTipSha,
          });
        }
        continue;
      }

      if (!fallbackBranch) {
        throw new Error(
          `Remote lineage branch missing for non-branch-backed resumed job ${job.jobId}: ${originBranch}`,
        );
      }

      await addWorktree({
        clonePath,
        worktreePath,
        baseRef: currentOriginTipSha,
        branch: fallbackBranch,
        ...(config.worktreeSetupCommand ? { setupCommand: config.worktreeSetupCommand } : {}),
        ...(config.worktreeSetupAllowFailure !== undefined
          ? { setupAllowFailure: config.worktreeSetupAllowFailure }
          : {}),
        logFilePath: paths.logFile,
        env,
        redact: redactionPatterns,
      });
      await runSetupContract(worktreePath, env, paths.logFile, redactionPatterns);

      repoWorktrees.set(repoKey, {
        clonePath,
        worktreePath,
        originBranch: fallbackBranch,
        detached: false,
        expectedBaseTipSha: currentOriginTipSha,
        worktreeBranch: fallbackBranch,
      });
      lineage.branchByRepo[repoKey] = fallbackBranch;
      lineage.originBranchByRepo[repoKey] = fallbackBranch;
      lineage.lineageBaseShaByRepo[repoKey] = currentOriginTipSha;
      lineage.lineageTipShaByRepo[repoKey] = currentOriginTipSha;
      lineage.lineageWarningByRepo[repoKey] =
        `Resumed from local-only lineage branch ${originBranch}; publishing to new branch ${fallbackBranch} from cached SHA ${currentOriginTipSha}.`;
      if (persistedBaseSha && persistedBaseSha !== persistedTipSha) {
        lineage.promptWarnings.push({
          kind: 'local-only-fallback',
          repoKey,
          originBranch,
          previousTipSha: persistedTipSha,
          currentTipSha: currentOriginTipSha,
          nextBranch: fallbackBranch,
        });
      }
      continue;
    }

    const baseRef = job.type === 'MENTION' ? mentionBaseRef : job.gitRef;
    const worktreeBranch = isBranchBackedJob(job) ? `${branchPrefix}/${job.jobId}` : undefined;

    await ensureClone(
      repoKey,
      repoConfig,
      clonePath,
      paths.logFile,
      env,
      baseRef,
      redactionPatterns,
      {
        checkoutRef: true,
        forceLocalBranchUpdate: true,
      },
    );
    await addWorktree({
      clonePath,
      worktreePath,
      baseRef,
      ...(config.worktreeSetupCommand ? { setupCommand: config.worktreeSetupCommand } : {}),
      ...(config.worktreeSetupAllowFailure !== undefined
        ? { setupAllowFailure: config.worktreeSetupAllowFailure }
        : {}),
      ...(worktreeBranch ? { branch: worktreeBranch } : {}),
      logFilePath: paths.logFile,
      env,
      redact: redactionPatterns,
    });
    await runSetupContract(worktreePath, env, paths.logFile, redactionPatterns);

    const worktreeHeadSha = await resolveGitRef(
      worktreePath,
      'HEAD',
      env,
      paths.logFile,
      redactionPatterns,
    );
    if (!worktreeHeadSha) {
      throw new Error(`Unable to resolve HEAD for worktree ${worktreePath}`);
    }

    const originBranch = worktreeBranch ?? baseRef;
    repoWorktrees.set(repoKey, {
      clonePath,
      worktreePath,
      originBranch,
      detached: !worktreeBranch,
      expectedBaseTipSha: worktreeHeadSha,
      ...(worktreeBranch ? { worktreeBranch } : {}),
    });

    if (worktreeBranch) {
      lineage.branchByRepo[repoKey] = worktreeBranch;
      lineage.originBranchByRepo[repoKey] = worktreeBranch;
      lineage.lineageBaseShaByRepo[repoKey] = worktreeHeadSha;
      lineage.lineageTipShaByRepo[repoKey] = worktreeHeadSha;
    }
  }

  return { repoWorktrees, lineage };
}
