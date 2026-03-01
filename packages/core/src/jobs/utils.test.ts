import { describe, expect, it } from 'vitest';

import { buildJobPaths, parseReviewerIds, validateJob } from './utils.js';

describe('jobs/utils', () => {
  it('builds job paths from JOB_WORK_ROOT', () => {
    const paths = buildJobPaths('/tmp/sniptail/job-root', 'job-123');

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
    const repoAllowlist = {
      'repo-one': { sshUrl: 'git@example.com:org/repo.git', projectId: 123 },
    };
    const baseJob = {
      jobId: 'job-123',
      type: 'ASK' as const,
      repoKeys: ['repo-one'],
      gitRef: 'main',
      requestText: 'Do the thing',
      channel: { provider: 'slack', channelId: 'C123', userId: 'U123' },
    };

    expect(() => validateJob(baseJob, repoAllowlist)).not.toThrow();
    expect(() => validateJob({ ...baseJob, repoKeys: ['missing-repo'] }, repoAllowlist)).toThrow(
      'Repo missing-repo is not in allowlist.',
    );
    expect(() => validateJob({ ...baseJob, gitRef: 'bad ref' }, repoAllowlist)).toThrow(
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

  it('validates RUN job params object shape', () => {
    const runJob = {
      jobId: 'job-run',
      type: 'RUN' as const,
      repoKeys: ['repo-one'],
      gitRef: 'main',
      requestText: 'Run deploy',
      run: {
        actionId: 'deploy',
        params: { target_env: 'staging' },
      },
      channel: { provider: 'slack' as const, channelId: 'C1', userId: 'U1' },
    };
    const repoAllowlist = {
      'repo-one': { sshUrl: 'git@example.com:org/repo.git', projectId: 123 },
    };

    expect(() => validateJob(runJob, repoAllowlist)).not.toThrow();
    expect(() =>
      validateJob({ ...runJob, run: { actionId: 'deploy', params: [] } }, repoAllowlist),
    ).toThrow('run.params as an object');
  });
});
