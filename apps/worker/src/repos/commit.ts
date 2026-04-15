import {
  commitAndPushLineage,
  type CommitAndPushLineageResult,
} from '@sniptail/core/git/jobOps.js';

export async function commitRepoChanges(options: {
  worktreePath: string;
  targetBranch: string;
  commitMessage: string;
  env: NodeJS.ProcessEnv;
  logFile: string;
  redactionPatterns: Array<string | RegExp>;
  worktreeBranch?: string;
  expectedRemoteSha?: string;
}): Promise<CommitAndPushLineageResult> {
  const {
    worktreePath,
    targetBranch,
    commitMessage,
    env,
    logFile,
    redactionPatterns,
    worktreeBranch,
    expectedRemoteSha,
  } = options;

  return commitAndPushLineage({
    repoPath: worktreePath,
    targetBranch,
    commitMessage,
    env,
    logFile,
    redact: redactionPatterns,
    ...(worktreeBranch ? { worktreeBranch } : {}),
    ...(expectedRemoteSha ? { expectedRemoteSha } : {}),
  });
}
