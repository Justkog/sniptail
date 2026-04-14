import { commitAndPush } from '@sniptail/core/git/jobOps.js';

export async function commitRepoChanges(
  worktreePath: string,
  branch: string,
  commitMessage: string,
  env: NodeJS.ProcessEnv,
  logFile: string,
  redactionPatterns: Array<string | RegExp>,
): Promise<boolean> {
  return commitAndPush(worktreePath, branch, commitMessage, env, logFile, redactionPatterns);
}
