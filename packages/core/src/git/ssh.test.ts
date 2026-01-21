import { describe, expect, it } from 'vitest';
import { isGitHubSshUrl, parseGitHubRepo, parseSshUrl } from './ssh.js';

describe('git/ssh', () => {
  it('parses ssh:// URLs with optional user', () => {
    expect(parseSshUrl('ssh://git@github.com/org/repo.git')).toEqual({
      host: 'github.com',
      path: 'org/repo.git',
    });
    expect(parseSshUrl('ssh://github.com/org/repo')).toEqual({
      host: 'github.com',
      path: 'org/repo',
    });
  });

  it('parses scp-like URLs', () => {
    expect(parseSshUrl('git@github.com:org/repo.git')).toEqual({
      host: 'github.com',
      path: 'org/repo.git',
    });
    expect(parseSshUrl('github.com:org/repo')).toEqual({
      host: 'github.com',
      path: 'org/repo',
    });
  });

  it('returns null for invalid ssh urls', () => {
    expect(parseSshUrl('github.com/org/repo')).toBeNull();
    expect(parseSshUrl('')).toBeNull();
  });

  it('detects github ssh urls case-insensitively', () => {
    expect(isGitHubSshUrl('git@GitHub.com:org/repo.git')).toBe(true);
    expect(isGitHubSshUrl('git@gitlab.com:org/repo.git')).toBe(false);
  });

  it('parses github repo owner/name from ssh url', () => {
    expect(parseGitHubRepo('git@github.com:org/repo.git')).toEqual({
      owner: 'org',
      repo: 'repo',
    });
  });

  it('returns null when github repo path is incomplete', () => {
    expect(parseGitHubRepo('git@github.com:org')).toBeNull();
    expect(parseGitHubRepo('git@github.com:')).toBeNull();
  });
});
