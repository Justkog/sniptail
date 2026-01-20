import { mkdir } from 'node:fs/promises';
import { runCommand } from '../runner/commandRunner.js';

export async function addWorktree(options: {
  clonePath: string;
  worktreePath: string;
  baseRef: string;
  branch?: string;
  logFilePath: string;
  env: NodeJS.ProcessEnv;
  redact?: Array<string | RegExp>;
}): Promise<void> {
  const { clonePath, worktreePath, baseRef, branch, logFilePath, env, redact = [] } = options;

  await mkdir(worktreePath, { recursive: true });

  const args = ['worktree', 'add', worktreePath];
  if (branch) {
    args.push('-b', branch, baseRef);
  } else {
    args.push(baseRef);
  }

  await runCommand('git', args, { cwd: clonePath, env, logFilePath, timeoutMs: 60_000, redact });
  await runCommand('pnpm', ['install', '--prefer-offline', '--no-lockfile'], {
    cwd: worktreePath,
    env,
    logFilePath,
    timeoutMs: 10 * 60_000,
    redact,
  });
}

export async function removeWorktree(options: {
  clonePath: string;
  worktreePath: string;
  logFilePath: string;
  env: NodeJS.ProcessEnv;
  redact?: Array<string | RegExp>;
}): Promise<void> {
  const { clonePath, worktreePath, logFilePath, env, redact = [] } = options;
  await runCommand('git', ['worktree', 'remove', '--force', worktreePath], {
    cwd: clonePath,
    env,
    logFilePath,
    redact,
    timeoutMs: 60_000,
    allowFailure: true,
  });
}
