import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('node:fs', () => ({
  existsSync: vi.fn(),
}));

vi.mock('node:fs/promises', () => ({
  mkdir: vi.fn(),
}));

vi.mock('../runner/commandRunner.js', () => ({
  runCommand: vi.fn(),
}));

import { existsSync } from 'node:fs';
import { runCommand } from '../runner/commandRunner.js';
import { ensureClone } from './mirror.js';

describe('git mirror ensureClone', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('forces local branch update by default when remote ref exists', async () => {
    vi.mocked(existsSync).mockReturnValue(true);
    // eslint-disable-next-line @typescript-eslint/require-await
    vi.mocked(runCommand).mockImplementation(async (_cmd, args) => {
      const joined = args.join(' ');
      if (joined === 'fetch --prune origin main:refs/remotes/origin/main') {
        return {
          cmd: 'git',
          args,
          durationMs: 1,
          exitCode: 0,
          signal: null,
          stdout: '',
          stderr: '',
          timedOut: false,
          aborted: false,
          cwd: '/tmp/cache/repo.git',
        };
      }
      if (joined === 'show-ref --verify refs/remotes/origin/main') {
        return {
          cmd: 'git',
          args,
          durationMs: 1,
          exitCode: 0,
          signal: null,
          stdout: 'hash refs/remotes/origin/main\n',
          stderr: '',
          timedOut: false,
          aborted: false,
          cwd: '/tmp/cache/repo.git',
        };
      }
      if (joined === 'rev-parse --abbrev-ref HEAD') {
        return {
          cmd: 'git',
          args,
          durationMs: 1,
          exitCode: 0,
          signal: null,
          stdout: 'dev\n',
          stderr: '',
          timedOut: false,
          aborted: false,
          cwd: '/tmp/cache/repo.git',
        };
      }
      if (joined === 'show-ref --verify refs/heads/main') {
        return {
          cmd: 'git',
          args,
          durationMs: 1,
          exitCode: 0,
          signal: null,
          stdout: 'hash refs/heads/main\n',
          stderr: '',
          timedOut: false,
          aborted: false,
          cwd: '/tmp/cache/repo.git',
        };
      }
      return {
        cmd: 'git',
        args,
        durationMs: 1,
        exitCode: 0,
        signal: null,
        stdout: '',
        stderr: '',
        timedOut: false,
        aborted: false,
        cwd: '/tmp/cache/repo.git',
      };
    });

    await ensureClone(
      'repo',
      { sshUrl: 'git@github.com:org/repo.git' },
      '/tmp/cache/repo.git',
      '/tmp/log.txt',
      {},
      'main',
    );

    expect(vi.mocked(runCommand)).toHaveBeenCalledWith(
      'git',
      ['branch', '--force', 'main', 'refs/remotes/origin/main'],
      expect.objectContaining({ cwd: '/tmp/cache/repo.git' }),
    );
  });

  it('does not force-update a local branch when disabled (resume-safe mode)', async () => {
    vi.mocked(existsSync).mockReturnValue(true);
    // eslint-disable-next-line @typescript-eslint/require-await
    vi.mocked(runCommand).mockImplementation(async (_cmd, args) => {
      const joined = args.join(' ');
      if (joined === 'fetch --prune origin sniptail/job-1:refs/remotes/origin/sniptail/job-1') {
        return {
          cmd: 'git',
          args,
          durationMs: 1,
          exitCode: 0,
          signal: null,
          stdout: '',
          stderr: '',
          timedOut: false,
          aborted: false,
          cwd: '/tmp/cache/repo.git',
        };
      }
      if (joined === 'show-ref --verify refs/remotes/origin/sniptail/job-1') {
        return {
          cmd: 'git',
          args,
          durationMs: 1,
          exitCode: 0,
          signal: null,
          stdout: 'hash refs/remotes/origin/sniptail/job-1\n',
          stderr: '',
          timedOut: false,
          aborted: false,
          cwd: '/tmp/cache/repo.git',
        };
      }
      if (joined === 'rev-parse --abbrev-ref HEAD') {
        return {
          cmd: 'git',
          args,
          durationMs: 1,
          exitCode: 0,
          signal: null,
          stdout: 'main\n',
          stderr: '',
          timedOut: false,
          aborted: false,
          cwd: '/tmp/cache/repo.git',
        };
      }
      if (joined === 'show-ref --verify refs/heads/sniptail/job-1') {
        return {
          cmd: 'git',
          args,
          durationMs: 1,
          exitCode: 0,
          signal: null,
          stdout: 'hash refs/heads/sniptail/job-1\n',
          stderr: '',
          timedOut: false,
          aborted: false,
          cwd: '/tmp/cache/repo.git',
        };
      }
      return {
        cmd: 'git',
        args,
        durationMs: 1,
        exitCode: 0,
        signal: null,
        stdout: '',
        stderr: '',
        timedOut: false,
        aborted: false,
        cwd: '/tmp/cache/repo.git',
      };
    });

    await ensureClone(
      'repo',
      { sshUrl: 'git@github.com:org/repo.git' },
      '/tmp/cache/repo.git',
      '/tmp/log.txt',
      {},
      'sniptail/job-1',
      [],
      { forceLocalBranchUpdate: false },
    );

    expect(vi.mocked(runCommand)).not.toHaveBeenCalledWith(
      'git',
      ['branch', '--force', 'sniptail/job-1', 'refs/remotes/origin/sniptail/job-1'],
      expect.anything(),
    );
  });

  it('creates local branch when remote ref exists but local branch does not', async () => {
    vi.mocked(existsSync).mockReturnValue(true);
    // eslint-disable-next-line @typescript-eslint/require-await
    vi.mocked(runCommand).mockImplementation(async (_cmd, args) => {
      const joined = args.join(' ');
      if (joined === 'fetch --prune origin feature:refs/remotes/origin/feature') {
        return {
          cmd: 'git',
          args,
          durationMs: 1,
          exitCode: 0,
          signal: null,
          stdout: '',
          stderr: '',
          timedOut: false,
          aborted: false,
          cwd: '/tmp/cache/repo.git',
        };
      }
      if (joined === 'show-ref --verify refs/remotes/origin/feature') {
        return {
          cmd: 'git',
          args,
          durationMs: 1,
          exitCode: 0,
          signal: null,
          stdout: 'hash refs/remotes/origin/feature\n',
          stderr: '',
          timedOut: false,
          aborted: false,
          cwd: '/tmp/cache/repo.git',
        };
      }
      if (joined === 'rev-parse --abbrev-ref HEAD') {
        return {
          cmd: 'git',
          args,
          durationMs: 1,
          exitCode: 0,
          signal: null,
          stdout: 'main\n',
          stderr: '',
          timedOut: false,
          aborted: false,
          cwd: '/tmp/cache/repo.git',
        };
      }
      if (joined === 'show-ref --verify refs/heads/feature') {
        return {
          cmd: 'git',
          args,
          durationMs: 1,
          exitCode: 1,
          signal: null,
          stdout: '',
          stderr: 'error: ref refs/heads/feature not found',
          timedOut: false,
          aborted: false,
          cwd: '/tmp/cache/repo.git',
        };
      }
      return {
        cmd: 'git',
        args,
        durationMs: 1,
        exitCode: 0,
        signal: null,
        stdout: '',
        stderr: '',
        timedOut: false,
        aborted: false,
        cwd: '/tmp/cache/repo.git',
      };
    });

    await ensureClone(
      'repo',
      { sshUrl: 'git@github.com:org/repo.git' },
      '/tmp/cache/repo.git',
      '/tmp/log.txt',
      {},
      'feature',
    );

    expect(vi.mocked(runCommand)).toHaveBeenCalledWith(
      'git',
      ['branch', 'feature', 'refs/remotes/origin/feature'],
      expect.objectContaining({ cwd: '/tmp/cache/repo.git' }),
    );
  });

  it('retries once when fetch fails with non-fast-forward for the same remote ref', async () => {
    vi.mocked(existsSync).mockReturnValue(true);
    let fetchAttempts = 0;
    // eslint-disable-next-line @typescript-eslint/require-await
    vi.mocked(runCommand).mockImplementation(async (_cmd, args) => {
      const joined = args.join(' ');
      if (joined === 'fetch --prune origin staging:refs/remotes/origin/staging') {
        fetchAttempts += 1;
        if (fetchAttempts === 1) {
          return {
            cmd: 'git',
            args,
            durationMs: 1,
            exitCode: 1,
            signal: null,
            stdout: '',
            stderr:
              'From github.com:org/repo\n' +
              ' ! [rejected]        staging    -> origin/staging  (non-fast-forward)',
            timedOut: false,
            aborted: false,
            cwd: '/tmp/cache/repo.git',
          };
        }
        return {
          cmd: 'git',
          args,
          durationMs: 1,
          exitCode: 0,
          signal: null,
          stdout: '',
          stderr: '',
          timedOut: false,
          aborted: false,
          cwd: '/tmp/cache/repo.git',
        };
      }
      if (joined === 'update-ref -d refs/remotes/origin/staging') {
        return {
          cmd: 'git',
          args,
          durationMs: 1,
          exitCode: 0,
          signal: null,
          stdout: '',
          stderr: '',
          timedOut: false,
          aborted: false,
          cwd: '/tmp/cache/repo.git',
        };
      }
      if (joined === 'show-ref --verify refs/remotes/origin/staging') {
        return {
          cmd: 'git',
          args,
          durationMs: 1,
          exitCode: 0,
          signal: null,
          stdout: 'hash refs/remotes/origin/staging\n',
          stderr: '',
          timedOut: false,
          aborted: false,
          cwd: '/tmp/cache/repo.git',
        };
      }
      if (joined === 'rev-parse --abbrev-ref HEAD') {
        return {
          cmd: 'git',
          args,
          durationMs: 1,
          exitCode: 0,
          signal: null,
          stdout: 'main\n',
          stderr: '',
          timedOut: false,
          aborted: false,
          cwd: '/tmp/cache/repo.git',
        };
      }
      if (joined === 'show-ref --verify refs/heads/staging') {
        return {
          cmd: 'git',
          args,
          durationMs: 1,
          exitCode: 0,
          signal: null,
          stdout: 'hash refs/heads/staging\n',
          stderr: '',
          timedOut: false,
          aborted: false,
          cwd: '/tmp/cache/repo.git',
        };
      }
      return {
        cmd: 'git',
        args,
        durationMs: 1,
        exitCode: 0,
        signal: null,
        stdout: '',
        stderr: '',
        timedOut: false,
        aborted: false,
        cwd: '/tmp/cache/repo.git',
      };
    });

    await ensureClone(
      'repo',
      { sshUrl: 'git@github.com:org/repo.git' },
      '/tmp/cache/repo.git',
      '/tmp/log.txt',
      {},
      'staging',
    );

    expect(fetchAttempts).toBe(2);
    expect(vi.mocked(runCommand)).toHaveBeenCalledWith(
      'git',
      ['update-ref', '-d', 'refs/remotes/origin/staging'],
      expect.objectContaining({ cwd: '/tmp/cache/repo.git' }),
    );
  });
});
