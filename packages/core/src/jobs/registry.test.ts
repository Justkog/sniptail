import { describe, expect, it, vi } from 'vitest';

vi.mock('../config/config.js', () => ({
  loadCoreConfig: () => ({
    repoAllowlistPath: '/tmp/sniptail/allowlist.json',
    repoAllowlist: {},
    jobWorkRoot: '/tmp/sniptail/job-root',
    jobRegistryPath: '/tmp/sniptail/registry',
    jobRegistryDriver: 'sqlite',
  }),
  loadWorkerConfig: () => ({
    repoAllowlistPath: '/tmp/sniptail/allowlist.json',
    repoAllowlist: {},
    jobWorkRoot: '/tmp/sniptail/job-root',
    jobRegistryPath: '/tmp/sniptail/registry',
    jobRegistryDriver: 'sqlite',
    botName: 'sniptail',
    redisUrl: 'redis://localhost:6379/0',
    primaryAgent: 'codex',
    copilot: { executionMode: 'local', idleRetries: 2 },
    repoCacheRoot: '/tmp/sniptail/repo-cache',
    includeRawRequestInMr: false,
    codex: { executionMode: 'local' },
  }),
}));

import { parseCleanupDurationMs, selectJobIdsBeyondMaxEntries } from './registry.js';

describe('jobs/registry cleanup helpers', () => {
  it('parses cleanup durations', () => {
    expect(parseCleanupDurationMs('7d')).toBe(7 * 86_400_000);
    expect(parseCleanupDurationMs('15m')).toBe(15 * 60_000);
    expect(parseCleanupDurationMs('2h')).toBe(2 * 3_600_000);
    expect(parseCleanupDurationMs('10s')).toBe(10 * 1000);
  });

  it('rejects invalid cleanup durations', () => {
    expect(() => parseCleanupDurationMs('')).toThrow('cleanup_max_age must be a non-empty');
    expect(() => parseCleanupDurationMs('5w')).toThrow('Invalid cleanup_max_age duration');
    expect(() => parseCleanupDurationMs('0h')).toThrow('Invalid cleanup_max_age duration');
  });

  it('selects jobs beyond max entries by createdAt', () => {
    const records = [
      { job: { jobId: 'job-1' }, createdAt: '2024-01-01T00:00:00Z' },
      { job: { jobId: 'job-2' }, createdAt: '2024-01-03T00:00:00Z' },
      { job: { jobId: 'job-3' }, createdAt: '2024-01-02T00:00:00Z' },
    ];
    expect(selectJobIdsBeyondMaxEntries(records as never, 1)).toEqual(['job-3', 'job-1']);
  });

  it('rejects invalid max entries', () => {
    expect(() => selectJobIdsBeyondMaxEntries([] as never, -1)).toThrow(
      'cleanup_max_entries must be a non-negative integer.',
    );
  });
});
