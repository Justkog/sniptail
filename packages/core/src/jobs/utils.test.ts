import { describe, expect, it, vi } from 'vitest';

vi.mock('../config/config.js', () => ({
  loadCoreConfig: () => ({
    repoAllowlist: {
      'repo-one': { sshUrl: 'git@example.com:org/repo.git', projectId: 123 },
    },
    jobWorkRoot: '/tmp/sniptail/job-root',
    jobRegistryPath: '/tmp/sniptail/registry',
    jobRegistryDriver: 'sqlite',
  }),
}));

import { buildJobPaths, parseReviewerIds, validateJob } from './utils.js';

describe('jobs/utils', () => {
  it('builds job paths from JOB_WORK_ROOT', () => {
    const paths = buildJobPaths('job-123');

    expect(paths.root).toBe('/tmp/sniptail/job-root/job-123');
    expect(paths.reposRoot).toBe('/tmp/sniptail/job-root/job-123/repos');
    expect(paths.artifactsRoot).toBe('/tmp/sniptail/job-root/job-123/artifacts');
    expect(paths.logsRoot).toBe('/tmp/sniptail/job-root/job-123/logs');
    expect(paths.logFile).toBe('/tmp/sniptail/job-root/job-123/logs/runner.log');
  });

  it('parses reviewer ids and filters invalid values', () => {
    expect(parseReviewerIds(undefined)).toBeUndefined();
    expect(parseReviewerIds(['123', 'abc', '456'])).toEqual([123, 456]);
    expect(parseReviewerIds(['abc'])).toBeUndefined();
  });

  it('validates repo allowlist and git ref for non-mention jobs', () => {
    const baseJob = {
      jobId: 'job-123',
      type: 'ASK' as const,
      repoKeys: ['repo-one'],
      gitRef: 'main',
      requestText: 'Do the thing',
      channel: { provider: 'slack', channelId: 'C123', userId: 'U123' },
    };

    expect(() => validateJob(baseJob)).not.toThrow();
    expect(() => validateJob({ ...baseJob, repoKeys: ['missing-repo'] })).toThrow(
      'Repo missing-repo is not in allowlist.',
    );
    expect(() => validateJob({ ...baseJob, gitRef: 'bad ref' })).toThrow(
      'Invalid git ref: bad ref',
    );
  });

  it('allows empty repo list for mention jobs', () => {
    expect(() =>
      validateJob({
        jobId: 'job-mention',
        type: 'MENTION',
        repoKeys: [],
        gitRef: 'not-checked',
        requestText: 'Hey',
        channel: { provider: 'slack', channelId: 'C123', userId: 'U123' },
      }),
    ).not.toThrow();
  });
});
