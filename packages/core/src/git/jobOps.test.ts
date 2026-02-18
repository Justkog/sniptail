import { constants as fsConstants } from 'node:fs';
import { access } from 'node:fs/promises';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('node:fs/promises', () => ({
  access: vi.fn(),
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
import { runChecks, runSetupContract } from './jobOps.js';

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
});
