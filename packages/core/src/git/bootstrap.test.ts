import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { resolveLocalRepoPath } from './bootstrap.js';

describe('git/bootstrap', () => {
  it('resolves relative paths under a root', () => {
    const result = resolveLocalRepoPath('team/repo', '/srv/repos');
    expect(result.path).toBe(resolve('/srv/repos', 'team/repo'));
  });

  it('rejects absolute paths when a root is set', () => {
    expect(() => resolveLocalRepoPath('/tmp/repo', '/srv/repos')).toThrow(
      'Local path must be relative',
    );
  });

  it('rejects paths outside the root', () => {
    expect(() => resolveLocalRepoPath('../repo', '/srv/repos')).toThrow(
      'Local path must stay within',
    );
  });

  it('resolves relative paths without a root', () => {
    const result = resolveLocalRepoPath('repo', undefined);
    expect(result.path).toBe(resolve('repo'));
  });
});
