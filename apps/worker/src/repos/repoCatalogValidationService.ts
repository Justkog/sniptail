import { access } from 'node:fs/promises';
import { findRepoCatalogEntry } from '@sniptail/core/repos/catalog.js';
import type { RepoRow } from '@sniptail/core/repos/catalogTypes.js';
import { getRepoProvider } from '@sniptail/core/repos/providers.js';
import { runCommand, type RunResult } from '@sniptail/core/runner/commandRunner.js';
import type { RepoConfig } from '@sniptail/core/types/job.js';
import { normalizeRepoKey } from './repoCatalogMutationService.js';

const GIT_TIMEOUT_MS = 30_000;

export type RepoCatalogValidationStatus = 'ok' | 'failed';

export type RepoCatalogValidationCheck = {
  id: string;
  status: RepoCatalogValidationStatus;
  message: string;
  command?: {
    cmd: string;
    args: string[];
    cwd?: string;
    exitCode: number | null;
    stderr?: string;
  };
};

export type RepoCatalogValidationSummary = {
  repoKey: string;
  provider: string;
  baseBranch: string;
  sourceType: 'localPath' | 'sshUrl' | 'missing';
  source: string;
  status: RepoCatalogValidationStatus;
  checkedAt: string;
};

export type RepoCatalogValidateResult = {
  command: 'validate';
  repoKey: string;
  normalizedFrom?: string;
  entry: RepoRow;
  summary: RepoCatalogValidationSummary;
  checks: RepoCatalogValidationCheck[];
};

function toRepoConfig(row: RepoRow): RepoConfig {
  return {
    provider: row.provider,
    ...(row.providerData ? { providerData: row.providerData } : {}),
    ...(row.sshUrl ? { sshUrl: row.sshUrl } : {}),
    ...(row.localPath ? { localPath: row.localPath } : {}),
    ...(row.projectId !== undefined ? { projectId: row.projectId } : {}),
    ...(row.baseBranch ? { baseBranch: row.baseBranch } : {}),
  };
}

function sourceSummary(row: RepoRow): Pick<RepoCatalogValidationSummary, 'sourceType' | 'source'> {
  if (row.localPath) {
    return { sourceType: 'localPath', source: row.localPath };
  }
  if (row.sshUrl) {
    return { sourceType: 'sshUrl', source: row.sshUrl };
  }
  return { sourceType: 'missing', source: '' };
}

function ok(id: string, message: string): RepoCatalogValidationCheck {
  return { id, status: 'ok', message };
}

function failed(
  id: string,
  message: string,
  command?: RepoCatalogValidationCheck['command'],
): RepoCatalogValidationCheck {
  return {
    id,
    status: 'failed',
    message,
    ...(command ? { command } : {}),
  };
}

function summarizeCommand(result: RunResult): RepoCatalogValidationCheck['command'] {
  const stderr = result.stderr.trim();
  return {
    cmd: result.cmd,
    args: result.args,
    ...(result.cwd ? { cwd: result.cwd } : {}),
    exitCode: result.exitCode,
    ...(stderr ? { stderr } : {}),
  };
}

function formatGitFailure(result: RunResult): string {
  const stderr = result.stderr.trim();
  if (stderr) return stderr;
  if (result.timedOut) return 'git command timed out.';
  return `git command failed with exit code ${result.exitCode ?? 'unknown'}.`;
}

function validateProvider(row: RepoRow): RepoCatalogValidationCheck {
  const provider = getRepoProvider(row.provider);
  if (!provider) {
    return failed('provider', `Unsupported repository provider: ${row.provider}`);
  }
  try {
    provider.validateRepoConfig?.(toRepoConfig(row));
    return ok('provider', `Provider "${row.provider}" supports this catalog entry.`);
  } catch (err) {
    return failed('provider', (err as Error).message);
  }
}

function validateSource(row: RepoRow): RepoCatalogValidationCheck {
  const sourceCount = [row.localPath, row.sshUrl].filter((source) => Boolean(source)).length;
  if (sourceCount !== 1) {
    return failed('source', 'Repository entry must define exactly one of localPath or sshUrl.');
  }
  return ok(
    'source',
    row.localPath ? `localPath is set: ${row.localPath}` : `sshUrl is set: ${row.sshUrl}`,
  );
}

function validateBaseBranch(row: RepoRow): RepoCatalogValidationCheck {
  const baseBranch = row.baseBranch.trim();
  if (!baseBranch) {
    return failed('baseBranch', 'baseBranch must be a non-empty string.');
  }
  return ok('baseBranch', `baseBranch is set: ${baseBranch}`);
}

async function validateLocalPath(row: RepoRow): Promise<RepoCatalogValidationCheck[]> {
  const checks: RepoCatalogValidationCheck[] = [];
  const localPath = row.localPath;
  const baseBranch = row.baseBranch.trim();
  if (!localPath) return checks;

  try {
    await access(localPath);
    checks.push(ok('localPath.exists', `Path exists: ${localPath}`));
  } catch {
    checks.push(failed('localPath.exists', `Path does not exist: ${localPath}`));
    return checks;
  }

  const worktree = await runCommand('git', ['rev-parse', '--is-inside-work-tree'], {
    cwd: localPath,
    allowFailure: true,
    timeoutMs: GIT_TIMEOUT_MS,
  });
  if ((worktree.exitCode ?? 1) !== 0 || worktree.stdout.trim() !== 'true') {
    checks.push(
      failed(
        'localPath.git',
        `Path is not a git worktree: ${localPath}`,
        summarizeCommand(worktree),
      ),
    );
    return checks;
  }
  checks.push(ok('localPath.git', `Path is a git worktree: ${localPath}`));

  if (!baseBranch) return checks;
  const branchRef = `refs/heads/${baseBranch}`;
  const branch = await runCommand('git', ['rev-parse', '--verify', branchRef], {
    cwd: localPath,
    allowFailure: true,
    timeoutMs: GIT_TIMEOUT_MS,
  });
  if ((branch.exitCode ?? 1) !== 0) {
    checks.push(
      failed(
        'localPath.baseBranch',
        `Base branch was not found locally: ${baseBranch}`,
        summarizeCommand(branch),
      ),
    );
    return checks;
  }
  checks.push(ok('localPath.baseBranch', `Base branch exists locally: ${baseBranch}`));
  return checks;
}

async function validateRemote(row: RepoRow): Promise<RepoCatalogValidationCheck[]> {
  const checks: RepoCatalogValidationCheck[] = [];
  const sshUrl = row.sshUrl;
  const baseBranch = row.baseBranch.trim();
  if (!sshUrl || !baseBranch) return checks;

  const result = await runCommand('git', ['ls-remote', '--heads', sshUrl, baseBranch], {
    allowFailure: true,
    timeoutMs: GIT_TIMEOUT_MS,
  });
  if ((result.exitCode ?? 1) !== 0) {
    checks.push(
      failed(
        'sshUrl.baseBranch',
        `Unable to reach remote base branch "${baseBranch}": ${formatGitFailure(result)}`,
        summarizeCommand(result),
      ),
    );
    return checks;
  }
  if (!result.stdout.trim()) {
    checks.push(
      failed(
        'sshUrl.baseBranch',
        `Remote base branch was not found: ${baseBranch}`,
        summarizeCommand(result),
      ),
    );
    return checks;
  }
  checks.push(ok('sshUrl.baseBranch', `Remote base branch is reachable: ${baseBranch}`));
  return checks;
}

export async function validateRepoCatalogEntryFromInput(
  repoKeyInput: string,
): Promise<RepoCatalogValidateResult> {
  const { repoKey, normalized } = normalizeRepoKey(repoKeyInput);
  const entry = await findRepoCatalogEntry(repoKey);
  if (!entry) {
    throw new Error(`Repository key "${repoKey}" was not found in the active catalog.`);
  }

  const checks: RepoCatalogValidationCheck[] = [
    validateProvider(entry),
    validateSource(entry),
    validateBaseBranch(entry),
  ];
  checks.push(...(await validateLocalPath(entry)));
  checks.push(...(await validateRemote(entry)));

  const status: RepoCatalogValidationStatus = checks.some((check) => check.status === 'failed')
    ? 'failed'
    : 'ok';
  const source = sourceSummary(entry);

  return {
    command: 'validate',
    repoKey,
    ...(normalized ? { normalizedFrom: repoKeyInput } : {}),
    entry,
    summary: {
      repoKey,
      provider: entry.provider,
      baseBranch: entry.baseBranch,
      sourceType: source.sourceType,
      source: source.source,
      status,
      checkedAt: new Date().toISOString(),
    },
    checks,
  };
}
