import { beforeEach, describe, expect, it, vi } from 'vitest';

const hoisted = vi.hoisted(() => ({
  access: vi.fn(),
  findRepoCatalogEntry: vi.fn(),
  runCommand: vi.fn(),
}));

vi.mock('node:fs/promises', () => ({
  access: hoisted.access,
}));

vi.mock('@sniptail/core/repos/catalog.js', () => ({
  findRepoCatalogEntry: hoisted.findRepoCatalogEntry,
}));

vi.mock('@sniptail/core/runner/commandRunner.js', () => ({
  runCommand: hoisted.runCommand,
}));

import { findRepoCatalogEntry } from '@sniptail/core/repos/catalog.js';
import { runCommand, type RunResult } from '@sniptail/core/runner/commandRunner.js';
import type { RepoRow } from '@sniptail/core/repos/catalogTypes.js';
import { validateRepoCatalogEntryFromInput } from './repoCatalogValidationService.js';

function makeRunResult(overrides: Partial<RunResult> = {}): RunResult {
  return {
    cmd: 'git',
    args: [],
    durationMs: 1,
    exitCode: 0,
    signal: null,
    stdout: '',
    stderr: '',
    timedOut: false,
    aborted: false,
    ...overrides,
  };
}

function makeRemoteRow(overrides: Partial<RepoRow> = {}): RepoRow {
  return {
    repoKey: 'my-api',
    provider: 'gitlab',
    sshUrl: 'git@gitlab.com:org/my-api.git',
    projectId: 12345,
    providerData: { projectId: 12345 },
    baseBranch: 'main',
    isActive: true,
    ...overrides,
  };
}

function makeLocalRow(overrides: Partial<RepoRow> = {}): RepoRow {
  return {
    repoKey: 'local-tools',
    provider: 'local',
    localPath: '/srv/repos/local-tools',
    baseBranch: 'main',
    isActive: true,
    ...overrides,
  };
}

describe('validateRepoCatalogEntryFromInput', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hoisted.access.mockResolvedValue(undefined);
  });

  it('validates a reachable remote base branch', async () => {
    const row = makeRemoteRow();
    vi.mocked(findRepoCatalogEntry).mockResolvedValueOnce(row);
    vi.mocked(runCommand).mockResolvedValueOnce(
      makeRunResult({
        args: ['ls-remote', '--heads', row.sshUrl ?? '', 'main'],
        stdout: 'abc123\trefs/heads/main\n',
      }),
    );

    const result = await validateRepoCatalogEntryFromInput('my-api');

    expect(result.command).toBe('validate');
    expect(result.repoKey).toBe('my-api');
    expect(result.entry).toBe(row);
    expect(result.summary.status).toBe('ok');
    expect(result.summary.sourceType).toBe('sshUrl');
    expect(result.summary.source).toBe('git@gitlab.com:org/my-api.git');
    expect(result.summary.checkedAt).toEqual(expect.any(String));
    expect(result.checks.map((check) => check.id)).toEqual([
      'provider',
      'source',
      'baseBranch',
      'sshUrl.baseBranch',
    ]);
    expect(result.checks.every((check) => check.status === 'ok')).toBe(true);
    expect(runCommand).toHaveBeenCalledWith('git', ['ls-remote', '--heads', row.sshUrl, 'main'], {
      allowFailure: true,
      timeoutMs: 30000,
    });
  });

  it('fails a remote repo when the remote cannot be reached', async () => {
    vi.mocked(findRepoCatalogEntry).mockResolvedValueOnce(makeRemoteRow());
    vi.mocked(runCommand).mockResolvedValueOnce(
      makeRunResult({
        args: ['ls-remote', '--heads', 'git@gitlab.com:org/my-api.git', 'main'],
        exitCode: 128,
        stderr: 'Permission denied',
      }),
    );

    const result = await validateRepoCatalogEntryFromInput('my-api');

    expect(result.summary.status).toBe('failed');
    const remoteCheck = result.checks.find((check) => check.id === 'sshUrl.baseBranch');
    expect(remoteCheck?.status).toBe('failed');
    expect(remoteCheck?.message).toContain('Permission denied');
    expect(remoteCheck?.command?.exitCode).toBe(128);
  });

  it('fails a remote repo when the base branch is missing', async () => {
    vi.mocked(findRepoCatalogEntry).mockResolvedValueOnce(makeRemoteRow());
    vi.mocked(runCommand).mockResolvedValueOnce(
      makeRunResult({
        args: ['ls-remote', '--heads', 'git@gitlab.com:org/my-api.git', 'main'],
        stdout: '',
      }),
    );

    const result = await validateRepoCatalogEntryFromInput('my-api');

    expect(result.summary.status).toBe('failed');
    const remoteCheck = result.checks.find((check) => check.id === 'sshUrl.baseBranch');
    expect(remoteCheck?.status).toBe('failed');
    expect(remoteCheck?.message).toBe('Remote base branch was not found: main');
  });

  it('validates a local git worktree with the base branch', async () => {
    const row = makeLocalRow();
    vi.mocked(findRepoCatalogEntry).mockResolvedValueOnce(row);
    vi.mocked(runCommand)
      .mockResolvedValueOnce(
        makeRunResult({
          args: ['rev-parse', '--is-inside-work-tree'],
          cwd: row.localPath,
          stdout: 'true\n',
        }),
      )
      .mockResolvedValueOnce(
        makeRunResult({
          args: ['rev-parse', '--verify', 'refs/heads/main'],
          cwd: row.localPath,
          stdout: 'abc123\n',
        }),
      );

    const result = await validateRepoCatalogEntryFromInput('local-tools');

    expect(result.summary.status).toBe('ok');
    expect(result.summary.sourceType).toBe('localPath');
    expect(result.checks.map((check) => check.id)).toEqual([
      'provider',
      'source',
      'baseBranch',
      'localPath.exists',
      'localPath.git',
      'localPath.baseBranch',
    ]);
    const firstCall = vi.mocked(runCommand).mock.calls[0];
    expect(firstCall?.[0]).toBe('git');
    expect(firstCall?.[1]).toEqual(['rev-parse', '--is-inside-work-tree']);
    expect(firstCall?.[2]).toMatchObject({
      cwd: '/srv/repos/local-tools',
      allowFailure: true,
      timeoutMs: 30000,
    });
  });

  it('fails a local repo when the path is missing', async () => {
    vi.mocked(findRepoCatalogEntry).mockResolvedValueOnce(makeLocalRow());
    hoisted.access.mockRejectedValueOnce(new Error('missing'));

    const result = await validateRepoCatalogEntryFromInput('local-tools');

    expect(result.summary.status).toBe('failed');
    expect(result.checks.at(-1)).toMatchObject({
      id: 'localPath.exists',
      status: 'failed',
      message: 'Path does not exist: /srv/repos/local-tools',
    });
    expect(runCommand).not.toHaveBeenCalled();
  });

  it('fails a local repo when the path is not a git worktree', async () => {
    vi.mocked(findRepoCatalogEntry).mockResolvedValueOnce(makeLocalRow());
    vi.mocked(runCommand).mockResolvedValueOnce(
      makeRunResult({
        args: ['rev-parse', '--is-inside-work-tree'],
        cwd: '/srv/repos/local-tools',
        exitCode: 128,
        stderr: 'fatal: not a git repository',
      }),
    );

    const result = await validateRepoCatalogEntryFromInput('local-tools');

    expect(result.summary.status).toBe('failed');
    const gitCheck = result.checks.find((check) => check.id === 'localPath.git');
    expect(gitCheck?.status).toBe('failed');
    expect(gitCheck?.command?.stderr).toBe('fatal: not a git repository');
  });

  it('fails a local repo when the base branch is missing', async () => {
    vi.mocked(findRepoCatalogEntry).mockResolvedValueOnce(makeLocalRow());
    vi.mocked(runCommand)
      .mockResolvedValueOnce(makeRunResult({ stdout: 'true\n' }))
      .mockResolvedValueOnce(makeRunResult({ exitCode: 128, stderr: 'unknown revision' }));

    const result = await validateRepoCatalogEntryFromInput('local-tools');

    expect(result.summary.status).toBe('failed');
    const branchCheck = result.checks.find((check) => check.id === 'localPath.baseBranch');
    expect(branchCheck?.status).toBe('failed');
    expect(branchCheck?.message).toBe('Base branch was not found locally: main');
  });

  it('reports normalized repo key input', async () => {
    vi.mocked(findRepoCatalogEntry).mockResolvedValueOnce(makeRemoteRow({ repoKey: 'my-api' }));
    vi.mocked(runCommand).mockResolvedValueOnce(
      makeRunResult({ stdout: 'abc123\trefs/heads/main\n' }),
    );

    const result = await validateRepoCatalogEntryFromInput('my api!');

    expect(findRepoCatalogEntry).toHaveBeenCalledWith('my-api');
    expect(result.repoKey).toBe('my-api');
    expect(result.normalizedFrom).toBe('my api!');
  });

  it('throws when the repo key is not active in the catalog', async () => {
    vi.mocked(findRepoCatalogEntry).mockResolvedValueOnce(undefined);

    await expect(validateRepoCatalogEntryFromInput('missing-repo')).rejects.toThrow(
      'Repository key "missing-repo" was not found in the active catalog.',
    );
  });

  it('reports unsupported provider and invalid shape as failed checks', async () => {
    vi.mocked(findRepoCatalogEntry).mockResolvedValueOnce(
      makeRemoteRow({
        provider: 'unknown',
        sshUrl: undefined,
        localPath: undefined,
      }),
    );

    const result = await validateRepoCatalogEntryFromInput('my-api');

    expect(result.summary.status).toBe('failed');
    expect(result.checks).toEqual([
      {
        id: 'provider',
        status: 'failed',
        message: 'Unsupported repository provider: unknown',
      },
      {
        id: 'source',
        status: 'failed',
        message: 'Repository entry must define exactly one of localPath or sshUrl.',
      },
      {
        id: 'baseBranch',
        status: 'ok',
        message: 'baseBranch is set: main',
      },
    ]);
  });
});
