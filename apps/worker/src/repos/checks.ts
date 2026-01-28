import { ensureCleanRepo, runChecks } from '@sniptail/core/git/jobOps.js';

export async function ensureRepoClean(
  worktreePath: string,
  env: NodeJS.ProcessEnv,
  logFile: string,
  redactionPatterns: Array<string | RegExp>,
): Promise<void> {
  await ensureCleanRepo(worktreePath, env, logFile, redactionPatterns);
}

export async function runRepoChecks(
  worktreePath: string,
  checks: string[] | undefined,
  env: NodeJS.ProcessEnv,
  logFile: string,
  redactionPatterns: Array<string | RegExp>,
): Promise<void> {
  await runChecks(worktreePath, checks, env, logFile, redactionPatterns);
}
