import { constants as fsConstants } from 'node:fs';
import { access, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('node:fs/promises', () => ({
  access: vi.fn(),
  mkdtemp: vi.fn(),
  writeFile: vi.fn(),
  rm: vi.fn(),
}));

vi.mock('../logger.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('../runner/commandRunner.js', () => ({
  runCommand: vi.fn(),
}));

import { runCommand } from '../runner/commandRunner.js';
import {
  commitAndPush,
  commitAndPushLineage,
  runChecks,
  runNamedRunContractDetailed,
  runSetupContract,
} from './jobOps.js';

function makeMissingPathError(): Error & { code: string } {
  return Object.assign(new Error('missing path'), { code: 'ENOENT' });
}

describe('git job operations contracts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('runs the setup contract when present and executable', async () => {
    const accessMock = vi.mocked(access);
    const runCommandMock = vi.mocked(runCommand);

    accessMock.mockResolvedValueOnce(undefined);
    accessMock.mockResolvedValueOnce(undefined);

    await expect(runSetupContract('/tmp/repo', {}, '/tmp/runner.log', [])).resolves.toBe(true);
    expect(accessMock).toHaveBeenNthCalledWith(1, '/tmp/repo/.sniptail/setup', fsConstants.F_OK);
    expect(accessMock).toHaveBeenNthCalledWith(2, '/tmp/repo/.sniptail/setup', fsConstants.X_OK);
    expect(runCommandMock).toHaveBeenCalledWith(
      '/tmp/repo/.sniptail/setup',
      [],
      expect.objectContaining({
        cwd: '/tmp/repo',
        logFilePath: '/tmp/runner.log',
        timeoutMs: 10 * 60_000,
      }),
    );
  });

  it('skips the setup contract when not present', async () => {
    const accessMock = vi.mocked(access);
    const runCommandMock = vi.mocked(runCommand);

    accessMock.mockRejectedValueOnce(makeMissingPathError());

    await expect(runSetupContract('/tmp/repo', {}, '/tmp/runner.log', [])).resolves.toBe(false);
    expect(runCommandMock).not.toHaveBeenCalled();
  });

  it('runs repo check contract before configured checks', async () => {
    const accessMock = vi.mocked(access);
    const runCommandMock = vi.mocked(runCommand);

    accessMock.mockResolvedValueOnce(undefined);
    accessMock.mockResolvedValueOnce(undefined);

    await runChecks('/tmp/repo', ['npm-lint'], {}, '/tmp/runner.log', []);

    expect(runCommandMock).toHaveBeenNthCalledWith(
      1,
      '/tmp/repo/.sniptail/check',
      [],
      expect.objectContaining({ cwd: '/tmp/repo' }),
    );
    expect(runCommandMock).toHaveBeenNthCalledWith(
      2,
      'npm',
      ['run', 'lint'],
      expect.objectContaining({ cwd: '/tmp/repo' }),
    );
  });

  it('runs repo check contract even when no explicit checks are configured', async () => {
    const accessMock = vi.mocked(access);
    const runCommandMock = vi.mocked(runCommand);

    accessMock.mockResolvedValueOnce(undefined);
    accessMock.mockResolvedValueOnce(undefined);

    await runChecks('/tmp/repo', undefined, {}, '/tmp/runner.log', []);

    expect(runCommandMock).toHaveBeenCalledTimes(1);
    expect(runCommandMock).toHaveBeenCalledWith(
      '/tmp/repo/.sniptail/check',
      [],
      expect.objectContaining({ cwd: '/tmp/repo' }),
    );
  });

  it('still runs configured checks when no repo contract exists', async () => {
    const accessMock = vi.mocked(access);
    const runCommandMock = vi.mocked(runCommand);

    accessMock.mockRejectedValueOnce(makeMissingPathError());

    await runChecks('/tmp/repo', ['npm-build'], {}, '/tmp/runner.log', []);

    expect(runCommandMock).toHaveBeenCalledTimes(1);
    expect(runCommandMock).toHaveBeenCalledWith(
      'npm',
      ['run', 'build'],
      expect.objectContaining({ cwd: '/tmp/repo' }),
    );
  });

  it('fails with a clear error when the repo check contract is not executable', async () => {
    const accessMock = vi.mocked(access);
    const permissionError = Object.assign(new Error('permission denied'), { code: 'EACCES' });

    accessMock.mockResolvedValueOnce(undefined);
    accessMock.mockRejectedValueOnce(permissionError);

    await expect(runChecks('/tmp/repo', undefined, {}, '/tmp/runner.log', [])).rejects.toThrow(
      'is not executable',
    );
  });

  it('returns executed=false when named run contract is missing', async () => {
    const accessMock = vi.mocked(access);

    accessMock.mockRejectedValueOnce(makeMissingPathError());

    await expect(
      runNamedRunContractDetailed('/tmp/repo', 'refresh-docs', {}, '/tmp/runner.log', []),
    ).resolves.toEqual({ executed: false });
  });

  it('returns detailed named run contract output when present and executable', async () => {
    const accessMock = vi.mocked(access);
    const runCommandMock = vi.mocked(runCommand);
    runCommandMock.mockResolvedValueOnce({
      cmd: '/tmp/repo/.sniptail/run/refresh-docs',
      args: [],
      cwd: '/tmp/repo',
      durationMs: 17,
      exitCode: 0,
      signal: null,
      stdout: 'ok\n',
      stderr: '',
      timedOut: false,
      aborted: false,
    });

    accessMock.mockResolvedValueOnce(undefined);
    accessMock.mockResolvedValueOnce(undefined);

    const execution = await runNamedRunContractDetailed(
      '/tmp/repo',
      'refresh-docs',
      {},
      '/tmp/runner.log',
      [],
    );

    expect(execution).toEqual(
      expect.objectContaining({
        executed: true,
        contractPath: '/tmp/repo/.sniptail/run/refresh-docs',
      }),
    );
    if (!execution.executed) {
      throw new Error('Expected named run contract to execute.');
    }
    expect(execution.result.stdout).toBe('ok\n');
    expect(execution.result.stderr).toBe('');
    expect(execution.result.durationMs).toBe(17);
  });

  it('rejects traversal-like run contract ids', async () => {
    await expect(
      runNamedRunContractDetailed('/tmp/repo', '../refresh', {}, '/tmp/runner.log', []),
    ).rejects.toThrow('Invalid run action id');
  });

  it('commits and pushes using an exclusive temp commit message file', async () => {
    const runCommandMock = vi.mocked(runCommand);
    const mkdtempMock = vi.mocked(mkdtemp);
    const writeFileMock = vi.mocked(writeFile);
    const rmMock = vi.mocked(rm);
    runCommandMock
      .mockResolvedValueOnce({
        cmd: 'git',
        args: ['status', '--porcelain'],
        cwd: '/tmp/repo',
        durationMs: 5,
        exitCode: 0,
        signal: null,
        stdout: ' M file.ts\n',
        stderr: '',
        timedOut: false,
        aborted: false,
      })
      .mockResolvedValueOnce({
        cmd: 'git',
        args: ['add', '-A'],
        cwd: '/tmp/repo',
        durationMs: 5,
        exitCode: 0,
        signal: null,
        stdout: '',
        stderr: '',
        timedOut: false,
        aborted: false,
      })
      .mockResolvedValueOnce({
        cmd: 'git',
        args: ['commit', '--file', '/tmp/sniptail-commit-message-abc123/message.txt'],
        cwd: '/tmp/repo',
        durationMs: 5,
        exitCode: 0,
        signal: null,
        stdout: '',
        stderr: '',
        timedOut: false,
        aborted: false,
      })
      .mockResolvedValueOnce({
        cmd: 'git',
        args: ['rev-parse', '--verify', 'HEAD'],
        cwd: '/tmp/repo',
        durationMs: 5,
        exitCode: 0,
        signal: null,
        stdout: 'feature-sha\n',
        stderr: '',
        timedOut: false,
        aborted: false,
      })
      .mockResolvedValue({
        cmd: 'git',
        args: [],
        cwd: '/tmp/repo',
        durationMs: 5,
        exitCode: 0,
        signal: null,
        stdout: '',
        stderr: '',
        timedOut: false,
        aborted: false,
      });
    mkdtempMock.mockResolvedValueOnce('/tmp/sniptail-commit-message-abc123');
    rmMock.mockResolvedValueOnce(undefined);

    await expect(
      commitAndPush(
        '/tmp/repo',
        'feature-branch',
        'feat: subject\n\nbody',
        {},
        '/tmp/runner.log',
        [],
      ),
    ).resolves.toBe(true);

    expect(writeFileMock).toHaveBeenCalledWith(
      '/tmp/sniptail-commit-message-abc123/message.txt',
      'feat: subject\n\nbody',
      { encoding: 'utf8', flag: 'wx' },
    );
    expect(runCommandMock).toHaveBeenNthCalledWith(
      3,
      'git',
      ['commit', '--file', '/tmp/sniptail-commit-message-abc123/message.txt'],
      expect.objectContaining({ cwd: '/tmp/repo' }),
    );
    expect(rmMock).toHaveBeenCalledWith('/tmp/sniptail-commit-message-abc123', {
      recursive: true,
      force: true,
    });
  });

  it('pushes detached lineage updates with force-with-lease when the branch tip matches', async () => {
    const runCommandMock = vi.mocked(runCommand);
    const mkdtempMock = vi.mocked(mkdtemp);
    const writeFileMock = vi.mocked(writeFile);
    const rmMock = vi.mocked(rm);

    runCommandMock
      .mockResolvedValueOnce({
        cmd: 'git',
        args: ['status', '--porcelain'],
        cwd: '/tmp/repo',
        durationMs: 5,
        exitCode: 0,
        signal: null,
        stdout: ' M file.ts\n',
        stderr: '',
        timedOut: false,
        aborted: false,
      })
      .mockResolvedValueOnce({
        cmd: 'git',
        args: ['add', '-A'],
        cwd: '/tmp/repo',
        durationMs: 5,
        exitCode: 0,
        signal: null,
        stdout: '',
        stderr: '',
        timedOut: false,
        aborted: false,
      })
      .mockResolvedValueOnce({
        cmd: 'git',
        args: ['commit'],
        cwd: '/tmp/repo',
        durationMs: 5,
        exitCode: 0,
        signal: null,
        stdout: '',
        stderr: '',
        timedOut: false,
        aborted: false,
      })
      .mockResolvedValueOnce({
        cmd: 'git',
        args: ['rev-parse', '--verify', 'HEAD'],
        cwd: '/tmp/repo',
        durationMs: 5,
        exitCode: 0,
        signal: null,
        stdout: 'newsha\n',
        stderr: '',
        timedOut: false,
        aborted: false,
      })
      .mockResolvedValueOnce({
        cmd: 'git',
        args: ['ls-remote', '--exit-code', '--heads', 'origin', 'refs/heads/feature-branch'],
        cwd: '/tmp/repo',
        durationMs: 5,
        exitCode: 0,
        signal: null,
        stdout: 'basesha\trefs/heads/feature-branch\n',
        stderr: '',
        timedOut: false,
        aborted: false,
      })
      .mockResolvedValueOnce({
        cmd: 'git',
        args: ['fetch', 'origin', '+refs/heads/feature-branch:refs/remotes/origin/feature-branch'],
        cwd: '/tmp/repo',
        durationMs: 5,
        exitCode: 0,
        signal: null,
        stdout: '',
        stderr: '',
        timedOut: false,
        aborted: false,
      })
      .mockResolvedValueOnce({
        cmd: 'git',
        args: ['rev-parse', '--verify', 'refs/remotes/origin/feature-branch'],
        cwd: '/tmp/repo',
        durationMs: 5,
        exitCode: 0,
        signal: null,
        stdout: 'basesha\n',
        stderr: '',
        timedOut: false,
        aborted: false,
      })
      .mockResolvedValueOnce({
        cmd: 'git',
        args: ['push'],
        cwd: '/tmp/repo',
        durationMs: 5,
        exitCode: 0,
        signal: null,
        stdout: '',
        stderr: '',
        timedOut: false,
        aborted: false,
      })
      .mockResolvedValueOnce({
        cmd: 'git',
        args: ['rev-parse', '--verify', 'HEAD'],
        cwd: '/tmp/repo',
        durationMs: 5,
        exitCode: 0,
        signal: null,
        stdout: 'newsha\n',
        stderr: '',
        timedOut: false,
        aborted: false,
      });
    mkdtempMock.mockResolvedValueOnce('/tmp/sniptail-commit-message-abc123');
    rmMock.mockResolvedValueOnce(undefined);

    const result = await commitAndPushLineage({
      repoPath: '/tmp/repo',
      targetBranch: 'feature-branch',
      commitMessage: 'feat: subject\n\nbody',
      env: {},
      logFile: '/tmp/runner.log',
      redact: [],
      expectedRemoteSha: 'basesha',
    });

    expect(result).toEqual({
      committed: true,
      rebased: false,
      targetBranch: 'feature-branch',
      commitSha: 'newsha',
      pushedSha: 'newsha',
    });
    expect(writeFileMock).toHaveBeenCalledWith(
      '/tmp/sniptail-commit-message-abc123/message.txt',
      'feat: subject\n\nbody',
      { encoding: 'utf8', flag: 'wx' },
    );
    expect(runCommandMock).toHaveBeenCalledWith(
      'git',
      ['push', '--force-with-lease=feature-branch:basesha', 'origin', 'HEAD:feature-branch'],
      expect.objectContaining({ cwd: '/tmp/repo' }),
    );
    expect(runCommandMock).toHaveBeenCalledWith(
      'git',
      ['ls-remote', '--exit-code', '--heads', 'origin', 'refs/heads/feature-branch'],
      expect.objectContaining({ cwd: '/tmp/repo', allowFailure: true }),
    );
    expect(runCommandMock).toHaveBeenCalledWith(
      'git',
      ['fetch', 'origin', '+refs/heads/feature-branch:refs/remotes/origin/feature-branch'],
      expect.objectContaining({ cwd: '/tmp/repo', allowFailure: true }),
    );
  });

  it('rebases detached lineage updates once when the branch moved', async () => {
    const runCommandMock = vi.mocked(runCommand);
    const mkdtempMock = vi.mocked(mkdtemp);
    const rmMock = vi.mocked(rm);

    runCommandMock
      .mockResolvedValueOnce({
        cmd: 'git',
        args: ['status', '--porcelain'],
        cwd: '/tmp/repo',
        durationMs: 5,
        exitCode: 0,
        signal: null,
        stdout: ' M file.ts\n',
        stderr: '',
        timedOut: false,
        aborted: false,
      })
      .mockResolvedValueOnce({
        cmd: 'git',
        args: ['add', '-A'],
        cwd: '/tmp/repo',
        durationMs: 5,
        exitCode: 0,
        signal: null,
        stdout: '',
        stderr: '',
        timedOut: false,
        aborted: false,
      })
      .mockResolvedValueOnce({
        cmd: 'git',
        args: ['commit'],
        cwd: '/tmp/repo',
        durationMs: 5,
        exitCode: 0,
        signal: null,
        stdout: '',
        stderr: '',
        timedOut: false,
        aborted: false,
      })
      .mockResolvedValueOnce({
        cmd: 'git',
        args: ['rev-parse', '--verify', 'HEAD'],
        cwd: '/tmp/repo',
        durationMs: 5,
        exitCode: 0,
        signal: null,
        stdout: 'old-commit-sha\n',
        stderr: '',
        timedOut: false,
        aborted: false,
      })
      .mockResolvedValueOnce({
        cmd: 'git',
        args: ['ls-remote', '--exit-code', '--heads', 'origin', 'refs/heads/feature-branch'],
        cwd: '/tmp/repo',
        durationMs: 5,
        exitCode: 0,
        signal: null,
        stdout: 'new-base-sha\trefs/heads/feature-branch\n',
        stderr: '',
        timedOut: false,
        aborted: false,
      })
      .mockResolvedValueOnce({
        cmd: 'git',
        args: ['fetch', 'origin', '+refs/heads/feature-branch:refs/remotes/origin/feature-branch'],
        cwd: '/tmp/repo',
        durationMs: 5,
        exitCode: 0,
        signal: null,
        stdout: '',
        stderr: '',
        timedOut: false,
        aborted: false,
      })
      .mockResolvedValueOnce({
        cmd: 'git',
        args: ['rev-parse', '--verify', 'refs/remotes/origin/feature-branch'],
        cwd: '/tmp/repo',
        durationMs: 5,
        exitCode: 0,
        signal: null,
        stdout: 'new-base-sha\n',
        stderr: '',
        timedOut: false,
        aborted: false,
      })
      .mockResolvedValueOnce({
        cmd: 'git',
        args: ['rebase', 'refs/remotes/origin/feature-branch'],
        cwd: '/tmp/repo',
        durationMs: 5,
        exitCode: 0,
        signal: null,
        stdout: '',
        stderr: '',
        timedOut: false,
        aborted: false,
      })
      .mockResolvedValueOnce({
        cmd: 'git',
        args: ['ls-remote', '--exit-code', '--heads', 'origin', 'refs/heads/feature-branch'],
        cwd: '/tmp/repo',
        durationMs: 5,
        exitCode: 0,
        signal: null,
        stdout: 'new-base-sha\trefs/heads/feature-branch\n',
        stderr: '',
        timedOut: false,
        aborted: false,
      })
      .mockResolvedValueOnce({
        cmd: 'git',
        args: ['fetch', 'origin', '+refs/heads/feature-branch:refs/remotes/origin/feature-branch'],
        cwd: '/tmp/repo',
        durationMs: 5,
        exitCode: 0,
        signal: null,
        stdout: '',
        stderr: '',
        timedOut: false,
        aborted: false,
      })
      .mockResolvedValueOnce({
        cmd: 'git',
        args: ['rev-parse', '--verify', 'refs/remotes/origin/feature-branch'],
        cwd: '/tmp/repo',
        durationMs: 5,
        exitCode: 0,
        signal: null,
        stdout: 'new-base-sha\n',
        stderr: '',
        timedOut: false,
        aborted: false,
      })
      .mockResolvedValueOnce({
        cmd: 'git',
        args: ['push'],
        cwd: '/tmp/repo',
        durationMs: 5,
        exitCode: 0,
        signal: null,
        stdout: '',
        stderr: '',
        timedOut: false,
        aborted: false,
      })
      .mockResolvedValueOnce({
        cmd: 'git',
        args: ['rev-parse', '--verify', 'HEAD'],
        cwd: '/tmp/repo',
        durationMs: 5,
        exitCode: 0,
        signal: null,
        stdout: 'rebased-sha\n',
        stderr: '',
        timedOut: false,
        aborted: false,
      });
    mkdtempMock.mockResolvedValueOnce('/tmp/sniptail-commit-message-abc123');
    rmMock.mockResolvedValueOnce(undefined);

    const result = await commitAndPushLineage({
      repoPath: '/tmp/repo',
      targetBranch: 'feature-branch',
      commitMessage: 'feat: subject\n\nbody',
      env: {},
      logFile: '/tmp/runner.log',
      redact: [],
      expectedRemoteSha: 'old-base-sha',
    });

    expect(result).toEqual({
      committed: true,
      rebased: true,
      targetBranch: 'feature-branch',
      commitSha: 'old-commit-sha',
      pushedSha: 'rebased-sha',
    });
    expect(runCommandMock).toHaveBeenCalledWith(
      'git',
      ['rebase', 'refs/remotes/origin/feature-branch'],
      expect.objectContaining({ cwd: '/tmp/repo', allowFailure: true }),
    );
  });

  it('treats ls-remote as the source of truth for existing lineage branches on origin', async () => {
    const runCommandMock = vi.mocked(runCommand);
    const mkdtempMock = vi.mocked(mkdtemp);
    const rmMock = vi.mocked(rm);

    runCommandMock
      .mockResolvedValueOnce({
        cmd: 'git',
        args: ['status', '--porcelain'],
        cwd: '/tmp/repo',
        durationMs: 5,
        exitCode: 0,
        signal: null,
        stdout: ' M file.ts\n',
        stderr: '',
        timedOut: false,
        aborted: false,
      })
      .mockResolvedValueOnce({
        cmd: 'git',
        args: ['add', '-A'],
        cwd: '/tmp/repo',
        durationMs: 5,
        exitCode: 0,
        signal: null,
        stdout: '',
        stderr: '',
        timedOut: false,
        aborted: false,
      })
      .mockResolvedValueOnce({
        cmd: 'git',
        args: ['commit'],
        cwd: '/tmp/repo',
        durationMs: 5,
        exitCode: 0,
        signal: null,
        stdout: '',
        stderr: '',
        timedOut: false,
        aborted: false,
      })
      .mockResolvedValueOnce({
        cmd: 'git',
        args: ['rev-parse', '--verify', 'HEAD'],
        cwd: '/tmp/repo',
        durationMs: 5,
        exitCode: 0,
        signal: null,
        stdout: 'newsha\n',
        stderr: '',
        timedOut: false,
        aborted: false,
      })
      .mockResolvedValueOnce({
        cmd: 'git',
        args: ['ls-remote', '--exit-code', '--heads', 'origin', 'refs/heads/feature-branch'],
        cwd: '/tmp/repo',
        durationMs: 5,
        exitCode: 0,
        signal: null,
        stdout: 'basesha\trefs/heads/feature-branch\n',
        stderr: '',
        timedOut: false,
        aborted: false,
      })
      .mockResolvedValueOnce({
        cmd: 'git',
        args: ['fetch', 'origin', '+refs/heads/feature-branch:refs/remotes/origin/feature-branch'],
        cwd: '/tmp/repo',
        durationMs: 5,
        exitCode: 0,
        signal: null,
        stdout: ' - [deleted]         (none)     -> origin/feature-branch\n',
        stderr: '',
        timedOut: false,
        aborted: false,
      })
      .mockResolvedValueOnce({
        cmd: 'git',
        args: ['rev-parse', '--verify', 'refs/remotes/origin/feature-branch'],
        cwd: '/tmp/repo',
        durationMs: 5,
        exitCode: 0,
        signal: null,
        stdout: 'basesha\n',
        stderr: '',
        timedOut: false,
        aborted: false,
      })
      .mockResolvedValueOnce({
        cmd: 'git',
        args: ['push'],
        cwd: '/tmp/repo',
        durationMs: 5,
        exitCode: 0,
        signal: null,
        stdout: '',
        stderr: '',
        timedOut: false,
        aborted: false,
      })
      .mockResolvedValueOnce({
        cmd: 'git',
        args: ['rev-parse', '--verify', 'HEAD'],
        cwd: '/tmp/repo',
        durationMs: 5,
        exitCode: 0,
        signal: null,
        stdout: 'newsha\n',
        stderr: '',
        timedOut: false,
        aborted: false,
      });
    mkdtempMock.mockResolvedValueOnce('/tmp/sniptail-commit-message-abc123');
    rmMock.mockResolvedValueOnce(undefined);

    const result = await commitAndPushLineage({
      repoPath: '/tmp/repo',
      targetBranch: 'feature-branch',
      commitMessage: 'feat: subject\n\nbody',
      env: {},
      logFile: '/tmp/runner.log',
      redact: [],
      expectedRemoteSha: 'basesha',
    });

    expect(result).toEqual({
      committed: true,
      rebased: false,
      targetBranch: 'feature-branch',
      commitSha: 'newsha',
      pushedSha: 'newsha',
    });
    expect(runCommandMock).not.toHaveBeenCalledWith(
      'git',
      ['fetch', '--prune', 'origin', 'feature-branch:refs/remotes/origin/feature-branch'],
      expect.anything(),
    );
  });
});
