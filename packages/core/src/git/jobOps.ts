import { constants as fsConstants } from 'node:fs';
import { access, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { logger } from '../logger.js';
import { runCommand, type RunResult } from '../runner/commandRunner.js';
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

export type RunNamedRunContractDetailedResult =
  | { executed: false }
  | { executed: true; contractPath: string; result: RunResult };

export async function runNamedRunContractDetailed(
  repoPath: string,
  actionId: string,
  env: NodeJS.ProcessEnv,
  logFile: string,
  redact: Array<string | RegExp>,
  options: {
    timeoutMs?: number;
    allowFailure?: boolean;
  } = {},
): Promise<RunNamedRunContractDetailedResult> {
  const normalizedActionId = normalizeRunActionId(actionId);
  const contractPath = getRunContractPath(repoPath, normalizedActionId);
  try {
    await access(contractPath, fsConstants.F_OK);
  } catch (err) {
    if (isMissingPath(err)) return { executed: false };
    throw err;
  }
  await ensureExecutableRunContract(contractPath, normalizedActionId);
  const result = await runCommand(contractPath, [], {
    cwd: repoPath,
    env,
    logFilePath: logFile,
    timeoutMs: options.timeoutMs ?? 10 * 60_000,
    redact,
    allowFailure: options.allowFailure ?? false,
  });
  return { executed: true, contractPath, result };
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

export type CommitAndPushLineageOptions = {
  repoPath: string;
  commitMessage: string;
  env: NodeJS.ProcessEnv;
  logFile: string;
  redact: Array<string | RegExp>;
  targetBranch: string;
  worktreeBranch?: string;
  expectedRemoteSha?: string;
};

export type CommitAndPushLineageResult =
  | { committed: false; rebased: false; targetBranch: string }
  | {
      committed: true;
      rebased: boolean;
      targetBranch: string;
      commitSha: string;
      pushedSha: string;
    };

export async function resolveGitRef(
  repoPath: string,
  ref: string,
  env: NodeJS.ProcessEnv,
  logFile: string,
  redact: Array<string | RegExp>,
): Promise<string | undefined> {
  const result = await runCommand('git', ['rev-parse', '--verify', ref], {
    cwd: repoPath,
    env,
    logFilePath: logFile,
    timeoutMs: 10_000,
    redact,
    allowFailure: true,
  });
  if ((result.exitCode ?? 1) !== 0) {
    return undefined;
  }
  const sha = result.stdout.trim();
  return sha || undefined;
}

async function fetchRemoteBranchTip(
  repoPath: string,
  branch: string,
  env: NodeJS.ProcessEnv,
  logFile: string,
  redact: Array<string | RegExp>,
): Promise<string | undefined> {
  const remoteRef = `refs/remotes/origin/${branch}`;
  const branchRef = `refs/heads/${branch}`;
  const lsRemoteResult = await runCommand(
    'git',
    ['ls-remote', '--exit-code', '--heads', 'origin', branchRef],
    {
      cwd: repoPath,
      env,
      logFilePath: logFile,
      timeoutMs: 60_000,
      redact,
      allowFailure: true,
    },
  );
  if ((lsRemoteResult.exitCode ?? 1) !== 0) {
    if ((lsRemoteResult.exitCode ?? 1) === 2) {
      return undefined;
    }
    throw new Error(
      `git ls-remote failed (${lsRemoteResult.exitCode ?? 'unknown'}): ${(
        lsRemoteResult.stderr ?? ''
      ).trim()}`,
    );
  }
  const remoteSha = lsRemoteResult.stdout.trim().split(/\s+/)[0]?.trim();
  if (!remoteSha) {
    return undefined;
  }

  const fetchRefspec = `+${branchRef}:${remoteRef}`;
  const fetchResult = await runCommand('git', ['fetch', 'origin', fetchRefspec], {
    cwd: repoPath,
    env,
    logFilePath: logFile,
    timeoutMs: 60_000,
    redact,
    allowFailure: true,
  });
  if ((fetchResult.exitCode ?? 1) !== 0) {
    const stderr = fetchResult.stderr ?? '';
    const cannotLockRef = stderr.includes('cannot lock ref') && stderr.includes(remoteRef);
    const nonFastForwardRemoteRef =
      stderr.includes('non-fast-forward') &&
      (stderr.includes(`-> origin/${branch}`) || stderr.includes(remoteRef));
    let retryResult: RunResult | undefined;
    if (cannotLockRef || nonFastForwardRemoteRef) {
      await runCommand('git', ['update-ref', '-d', remoteRef], {
        cwd: repoPath,
        env,
        logFilePath: logFile,
        timeoutMs: 10_000,
        redact,
        allowFailure: true,
      });
      retryResult = await runCommand('git', ['fetch', 'origin', fetchRefspec], {
        cwd: repoPath,
        env,
        logFilePath: logFile,
        timeoutMs: 60_000,
        redact,
        allowFailure: true,
      });
    }
    const retriedOk = retryResult ? (retryResult.exitCode ?? 1) === 0 : false;
    if (!retriedOk) {
      throw new Error(
        `git fetch failed (${retryResult?.exitCode ?? fetchResult.exitCode ?? 'unknown'}): ${(
          retryResult?.stderr ?? stderr
        ).trim()}`,
      );
    }
  }

  const localRemoteSha = await resolveGitRef(repoPath, remoteRef, env, logFile, redact);
  if (!localRemoteSha) {
    throw new Error(`Unable to resolve fetched remote branch ${branch}`);
  }

  return localRemoteSha;
}

async function commitOnHead(
  repoPath: string,
  commitMessage: string,
  env: NodeJS.ProcessEnv,
  logFile: string,
  redact: Array<string | RegExp>,
): Promise<string | undefined> {
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
    return undefined;
  }

  await runCommand('git', ['add', '-A'], {
    cwd: repoPath,
    env,
    logFilePath: logFile,
    timeoutMs: 30_000,
    redact,
  });
  const commitMessageDir = await mkdtemp(join(tmpdir(), 'sniptail-commit-message-'));
  const commitMessageFile = join(commitMessageDir, 'message.txt');
  await writeFile(commitMessageFile, commitMessage, { encoding: 'utf8', flag: 'wx' });
  try {
    await runCommand('git', ['commit', '--file', commitMessageFile], {
      cwd: repoPath,
      env,
      logFilePath: logFile,
      timeoutMs: 30_000,
      redact,
    });
  } finally {
    await rm(commitMessageDir, { recursive: true, force: true }).catch(() => undefined);
  }
  const commitSha = await resolveGitRef(repoPath, 'HEAD', env, logFile, redact);
  if (!commitSha) {
    throw new Error(`Unable to resolve HEAD after commit in ${repoPath}`);
  }
  return commitSha;
}

export async function commitAndPushLineage(
  options: CommitAndPushLineageOptions,
): Promise<CommitAndPushLineageResult> {
  const {
    repoPath,
    commitMessage,
    env,
    logFile,
    redact,
    targetBranch,
    worktreeBranch,
    expectedRemoteSha,
  } = options;

  const initialCommitSha = await commitOnHead(repoPath, commitMessage, env, logFile, redact);
  if (!initialCommitSha) {
    return { committed: false, rebased: false, targetBranch };
  }

  if (!expectedRemoteSha && worktreeBranch && worktreeBranch === targetBranch) {
    await runCommand('git', ['push', 'origin', targetBranch], {
      cwd: repoPath,
      env,
      logFilePath: logFile,
      timeoutMs: 60_000,
      redact,
    });
    return {
      committed: true,
      rebased: false,
      targetBranch,
      commitSha: initialCommitSha,
      pushedSha: initialCommitSha,
    };
  }

  const remoteTip = await fetchRemoteBranchTip(repoPath, targetBranch, env, logFile, redact);
  if (!remoteTip) {
    throw new Error(`Origin branch missing for lineage update: ${targetBranch}`);
  }
  if (!expectedRemoteSha) {
    throw new Error(`Missing expected remote SHA for lineage branch ${targetBranch}`);
  }

  let leaseSha = expectedRemoteSha;
  let rebased = false;

  if (remoteTip !== expectedRemoteSha) {
    const rebaseResult = await runCommand(
      'git',
      ['rebase', `refs/remotes/origin/${targetBranch}`],
      {
        cwd: repoPath,
        env,
        logFilePath: logFile,
        timeoutMs: 60_000,
        redact,
        allowFailure: true,
      },
    );
    if ((rebaseResult.exitCode ?? 1) !== 0) {
      await runCommand('git', ['rebase', '--abort'], {
        cwd: repoPath,
        env,
        logFilePath: logFile,
        timeoutMs: 30_000,
        redact,
        allowFailure: true,
      });
      throw new Error(
        `Lineage branch moved and automatic rebase failed for ${targetBranch}. Expected ${expectedRemoteSha}, observed ${remoteTip}.`,
      );
    }
    const remoteTipAfterRebase = await fetchRemoteBranchTip(
      repoPath,
      targetBranch,
      env,
      logFile,
      redact,
    );
    if (!remoteTipAfterRebase) {
      throw new Error(`Origin branch missing after rebase for lineage update: ${targetBranch}`);
    }
    if (remoteTipAfterRebase !== remoteTip) {
      throw new Error(
        `Lineage branch moved again during retry for ${targetBranch}. Expected ${remoteTip}, observed ${remoteTipAfterRebase}.`,
      );
    }
    leaseSha = remoteTip;
    rebased = true;
  }

  await runCommand(
    'git',
    ['push', `--force-with-lease=${targetBranch}:${leaseSha}`, 'origin', `HEAD:${targetBranch}`],
    {
      cwd: repoPath,
      env,
      logFilePath: logFile,
      timeoutMs: 60_000,
      redact,
    },
  );
  const pushedSha = await resolveGitRef(repoPath, 'HEAD', env, logFile, redact);
  if (!pushedSha) {
    throw new Error(`Unable to resolve HEAD after pushing lineage branch ${targetBranch}`);
  }

  return {
    committed: true,
    rebased,
    targetBranch,
    commitSha: initialCommitSha,
    pushedSha,
  };
}

export async function commitAndPush(
  repoPath: string,
  branch: string,
  commitMessage: string,
  env: NodeJS.ProcessEnv,
  logFile: string,
  redact: Array<string | RegExp>,
): Promise<boolean> {
  const result = await commitAndPushLineage({
    repoPath,
    commitMessage,
    env,
    logFile,
    redact,
    targetBranch: branch,
    worktreeBranch: branch,
  });
  return result.committed;
}
