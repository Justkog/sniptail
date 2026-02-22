import { constants as fsConstants } from 'node:fs';
import { access } from 'node:fs/promises';
import { join } from 'node:path';
import { logger } from '../logger.js';
import { runCommand } from '../runner/commandRunner.js';
import { normalizeRunActionId } from '../repos/runActions.js';

const SNIPTAIL_CONTRACT_DIR = '.sniptail';
const SETUP_CONTRACT_NAME = 'setup';
const CHECK_CONTRACT_NAME = 'check';
const RUN_CONTRACT_DIR_NAME = 'run';

function isMissingPath(err: unknown): boolean {
  const code = (err as NodeJS.ErrnoException | undefined)?.code;
  return code === 'ENOENT' || code === 'ENOTDIR';
}

function getContractPath(repoPath: string, contractName: string): string {
  return join(repoPath, SNIPTAIL_CONTRACT_DIR, contractName);
}

function getRunContractPath(repoPath: string, actionId: string): string {
  const normalizedActionId = normalizeRunActionId(actionId);
  return join(repoPath, SNIPTAIL_CONTRACT_DIR, RUN_CONTRACT_DIR_NAME, normalizedActionId);
}

async function resolveContractPath(
  repoPath: string,
  contractName: string,
): Promise<string | undefined> {
  const contractPath = getContractPath(repoPath, contractName);
  try {
    await access(contractPath, fsConstants.F_OK);
    return contractPath;
  } catch (err) {
    if (isMissingPath(err)) return undefined;
    throw err;
  }
}

async function ensureExecutableContract(contractPath: string, contractName: string): Promise<void> {
  try {
    await access(contractPath, fsConstants.X_OK);
  } catch {
    throw new Error(
      `Repo contract "${SNIPTAIL_CONTRACT_DIR}/${contractName}" exists but is not executable: ${contractPath}. Run chmod +x ${contractPath}.`,
    );
  }
}

async function ensureExecutableRunContract(contractPath: string, actionId: string): Promise<void> {
  try {
    await access(contractPath, fsConstants.X_OK);
  } catch {
    throw new Error(
      `Repo run contract "${SNIPTAIL_CONTRACT_DIR}/${RUN_CONTRACT_DIR_NAME}/${actionId}" exists but is not executable: ${contractPath}. Run chmod +x ${contractPath}.`,
    );
  }
}

async function runContract(
  repoPath: string,
  contractName: string,
  env: NodeJS.ProcessEnv,
  logFile: string,
  redact: Array<string | RegExp>,
): Promise<boolean> {
  const contractPath = await resolveContractPath(repoPath, contractName);
  if (!contractPath) return false;
  await ensureExecutableContract(contractPath, contractName);
  await runCommand(contractPath, [], {
    cwd: repoPath,
    env,
    logFilePath: logFile,
    timeoutMs: 10 * 60_000,
    redact,
  });
  return true;
}

export async function runSetupContract(
  repoPath: string,
  env: NodeJS.ProcessEnv,
  logFile: string,
  redact: Array<string | RegExp>,
): Promise<boolean> {
  return runContract(repoPath, SETUP_CONTRACT_NAME, env, logFile, redact);
}

export async function runCheckContract(
  repoPath: string,
  env: NodeJS.ProcessEnv,
  logFile: string,
  redact: Array<string | RegExp>,
): Promise<boolean> {
  return runContract(repoPath, CHECK_CONTRACT_NAME, env, logFile, redact);
}

export async function runNamedRunContract(
  repoPath: string,
  actionId: string,
  env: NodeJS.ProcessEnv,
  logFile: string,
  redact: Array<string | RegExp>,
  options: {
    timeoutMs?: number;
    allowFailure?: boolean;
  } = {},
): Promise<boolean> {
  const normalizedActionId = normalizeRunActionId(actionId);
  const contractPath = getRunContractPath(repoPath, normalizedActionId);
  try {
    await access(contractPath, fsConstants.F_OK);
  } catch (err) {
    if (isMissingPath(err)) return false;
    throw err;
  }
  await ensureExecutableRunContract(contractPath, normalizedActionId);
  await runCommand(contractPath, [], {
    cwd: repoPath,
    env,
    logFilePath: logFile,
    timeoutMs: options.timeoutMs ?? 10 * 60_000,
    redact,
    allowFailure: options.allowFailure ?? false,
  });
  return true;
}

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
  const ranContract = await runCheckContract(repoPath, env, logFile, redact);
  if (!checks || checks.length === 0) {
    if (!ranContract) {
      logger.info({ repoPath }, 'No validations configured');
    }
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

  await runCommand('git', ['add', '-A'], {
    cwd: repoPath,
    env,
    logFilePath: logFile,
    timeoutMs: 30_000,
    redact,
  });
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
