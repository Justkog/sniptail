import { commitAndPush } from '@sniptail/core/git/jobOps.js';

export async function commitRepoChanges(
  worktreePath: string,
  branch: string,
  jobId: string,
  botName: string,
  env: NodeJS.ProcessEnv,
  logFile: string,
  redactionPatterns: Array<string | RegExp>,
): Promise<boolean> {
  return commitAndPush(worktreePath, branch, jobId, botName, env, logFile, redactionPatterns);
}
