import { describe, expect, it, vi } from 'vitest';
import { assertGitCommitIdentityPreflight } from './gitPreflight.js';

describe('git preflight', () => {
  it('checks git author and committer identity', async () => {
    const runExec = vi.fn().mockResolvedValue({ stdout: '', stderr: '' });
    await assertGitCommitIdentityPreflight(runExec);
    expect(runExec).toHaveBeenCalledWith('git', ['var', 'GIT_AUTHOR_IDENT']);
    expect(runExec).toHaveBeenCalledWith('git', ['var', 'GIT_COMMITTER_IDENT']);
  });

  it('fails fast with actionable guidance when identity is unavailable', async () => {
    const runExec = vi.fn().mockRejectedValue(
      Object.assign(new Error('failed to run git'), {
        stderr: 'Author identity unknown',
      }),
    );

    await expect(assertGitCommitIdentityPreflight(runExec)).rejects.toThrow('Git preflight failed');
    await expect(assertGitCommitIdentityPreflight(runExec)).rejects.toThrow(
      'git config --global user.name',
    );
    await expect(assertGitCommitIdentityPreflight(runExec)).rejects.toThrow(
      'git config --global user.email',
    );
    await expect(assertGitCommitIdentityPreflight(runExec)).rejects.toThrow(
      'git var GIT_AUTHOR_IDENT',
    );
    await expect(assertGitCommitIdentityPreflight(runExec)).rejects.toThrow(
      'Author identity unknown',
    );
  });
});
