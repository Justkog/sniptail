import { logger } from '../logger.js';
import { runCommand } from '../runner/commandRunner.js';

export async function ensureCleanRepo(
  repoPath: string,
  env: NodeJS.ProcessEnv,
  logFile: string,
  redact: Array<string | RegExp>,
) {
  const status = await runCommand('git', ['status', '--porcelain'], {
    cwd: repoPath,
    env,
    logFilePath: logFile,
    redact,
    timeoutMs: 10_000,
    allowFailure: true,
  });
  if (status.stdout.trim()) {
    throw new Error(`Repo dirty after ASK run: ${repoPath}`);
  }
}

export async function runChecks(
  repoPath: string,
  checks: string[] | undefined,
  env: NodeJS.ProcessEnv,
  logFile: string,
  redact: Array<string | RegExp>,
) {
  if (!checks || checks.length === 0) {
    logger.info({ repoPath }, 'No validations configured');
    return;
  }

  const commands: Record<string, string[]> = {
    'npm-test': ['npm', 'test'],
    'npm-lint': ['npm', 'run', 'lint'],
    'npm-build': ['npm', 'run', 'build'],
  };

  for (const check of checks) {
    const cmd = commands[check];
    if (!cmd) {
      logger.warn({ check }, 'Unknown validation check');
      continue;
    }
    const [command, ...args] = cmd;
    if (!command) {
      logger.warn({ check }, 'Validation command missing');
      continue;
    }
    await runCommand(command, args, {
      cwd: repoPath,
      env,
      logFilePath: logFile,
      timeoutMs: 10 * 60_000,
      redact,
    });
  }
}

export async function commitAndPush(
  repoPath: string,
  branch: string,
  jobId: string,
  botName: string,
  env: NodeJS.ProcessEnv,
  logFile: string,
  redact: Array<string | RegExp>,
): Promise<boolean> {
  const status = await runCommand('git', ['status', '--porcelain'], {
    cwd: repoPath,
    env,
    logFilePath: logFile,
    redact,
    timeoutMs: 10_000,
    allowFailure: true,
  });

  if (!status.stdout.trim()) {
    logger.info({ repoPath }, 'No changes to commit');
    return false;
  }

  await runCommand('git', ['add', '-A'], { cwd: repoPath, env, logFilePath: logFile, timeoutMs: 30_000, redact });
  await runCommand('git', ['commit', '-m', `${botName}: ${jobId}`], {
    cwd: repoPath,
    env,
    logFilePath: logFile,
    timeoutMs: 30_000,
    redact,
  });
  await runCommand('git', ['push', 'origin', branch], {
    cwd: repoPath,
    env,
    logFilePath: logFile,
    timeoutMs: 60_000,
    redact,
  });
  return true;
}
