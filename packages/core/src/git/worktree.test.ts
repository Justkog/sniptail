import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('node:fs/promises', () => ({
  mkdir: vi.fn(),
}));

vi.mock('../runner/commandRunner.js', () => ({
  runCommand: vi.fn(),
}));

import { mkdir } from 'node:fs/promises';
import { runCommand } from '../runner/commandRunner.js';
import { addWorktree } from './worktree.js';

describe('git worktree helper', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('adds a branched worktree for branch-backed jobs', async () => {
    const runCommandMock = vi.mocked(runCommand);

    await addWorktree({
      clonePath: '/tmp/cache/repo.git',
      worktreePath: '/tmp/jobs/job-1/repos/repo',
      baseRef: 'main',
      branch: 'sniptail/job-1',
      logFilePath: '/tmp/jobs/job-1/logs/runner.log',
      env: {},
      redact: [],
    });

    expect(mkdir).toHaveBeenCalledWith('/tmp/jobs/job-1/repos/repo', { recursive: true });
    expect(runCommandMock).toHaveBeenNthCalledWith(
      1,
      'git',
      ['worktree', 'add', '/tmp/jobs/job-1/repos/repo', '-b', 'sniptail/job-1', 'main'],
      expect.objectContaining({ cwd: '/tmp/cache/repo.git' }),
    );
  });

  it('adds a detached worktree for non-branch jobs', async () => {
    const runCommandMock = vi.mocked(runCommand);

    await addWorktree({
      clonePath: '/tmp/cache/repo.git',
      worktreePath: '/tmp/jobs/job-2/repos/repo',
      baseRef: 'staging',
      logFilePath: '/tmp/jobs/job-2/logs/runner.log',
      env: {},
      redact: [],
    });

    expect(runCommandMock).toHaveBeenNthCalledWith(
      1,
      'git',
      ['worktree', 'add', '/tmp/jobs/job-2/repos/repo', '--detach', 'staging'],
      expect.objectContaining({ cwd: '/tmp/cache/repo.git' }),
    );
  });

  it('runs an optional setup command in the worktree', async () => {
    const runCommandMock = vi.mocked(runCommand);

    await addWorktree({
      clonePath: '/tmp/cache/repo.git',
      worktreePath: '/tmp/jobs/job-3/repos/repo',
      baseRef: 'main',
      setupCommand: 'pnpm install --prefer-offline --no-lockfile',
      setupAllowFailure: true,
      logFilePath: '/tmp/jobs/job-3/logs/runner.log',
      env: {},
      redact: [],
    });

    expect(runCommandMock).toHaveBeenNthCalledWith(
      2,
      'bash',
      ['-lc', 'pnpm install --prefer-offline --no-lockfile'],
      expect.objectContaining({
        cwd: '/tmp/jobs/job-3/repos/repo',
        allowFailure: true,
      }),
    );
  });
});
