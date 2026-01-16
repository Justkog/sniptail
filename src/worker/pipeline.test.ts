import { describe, expect, it, vi } from 'vitest';

vi.mock('../config/index.js', () => ({
  config: {
    botName: 'sniptail',
    repoAllowlist: {},
    jobWorkRoot: '/tmp/sniptail/job-root',
    repoCacheRoot: '/tmp/sniptail/repo-cache',
    jobRootCopyGlob: undefined,
    openAiKey: undefined,
    gitlab: undefined,
    github: undefined,
    codex: {
      executionMode: 'local',
      dockerfilePath: undefined,
      dockerImage: undefined,
      dockerBuildContext: undefined,
    },
  },
}));

vi.mock('../runner/commandRunner.js', () => ({
  runCommand: vi.fn(),
}));

vi.mock('../jobs/registry.js', () => ({
  findLatestJobBySlackThread: vi.fn(),
  findLatestJobBySlackThreadAndTypes: vi.fn(),
  loadJobRecord: vi.fn(),
  updateJobRecord: vi.fn(),
}));

vi.mock('../codex/index.js', () => ({
  runCodex: vi.fn(),
}));

vi.mock('../git/mirror.js', () => ({
  ensureClone: vi.fn(),
}));

vi.mock('../git/worktree.js', () => ({
  addWorktree: vi.fn(),
  removeWorktree: vi.fn(),
}));

vi.mock('../git/jobOps.js', () => ({
  commitAndPush: vi.fn(),
  ensureCleanRepo: vi.fn(),
  runChecks: vi.fn(),
}));

vi.mock('../slack/helpers.js', () => ({
  postMessage: vi.fn(),
  uploadFile: vi.fn(),
}));

vi.mock('../slack/ids.js', () => ({
  buildSlackIds: vi.fn(),
}));

vi.mock('../slack/blocks.js', () => ({
  buildCompletionBlocks: vi.fn(),
}));

vi.mock('../github/client.js', () => ({
  createPullRequest: vi.fn(),
}));

vi.mock('../gitlab/client.js', () => ({
  createMergeRequest: vi.fn(),
}));

vi.mock('node:fs/promises', () => ({
  appendFile: vi.fn(),
  mkdir: vi.fn(),
  readFile: vi.fn(),
  rm: vi.fn(),
  writeFile: vi.fn(),
}));

import type { App } from '@slack/bolt';
import { appendFile, mkdir, writeFile } from 'node:fs/promises';
import { findLatestJobBySlackThread, findLatestJobBySlackThreadAndTypes, loadJobRecord, updateJobRecord } from '../jobs/registry.js';
import { runCommand } from '../runner/commandRunner.js';
import { runCodex } from '../codex/index.js';
import { postMessage } from '../slack/helpers.js';
import { buildSlackIds } from '../slack/ids.js';
import { ensureClone } from '../git/mirror.js';
import { copyJobRootSeed, resolveCodexThreadId, resolveMentionWorkingDirectory, runJob } from './pipeline.js';

describe('worker/pipeline helpers', () => {
  it('copyJobRootSeed skips when glob is empty', async () => {
    const runCommandMock = vi.mocked(runCommand);

    await copyJobRootSeed('   ', '/tmp/job-root', {}, '/tmp/runner.log', []);

    expect(runCommandMock).not.toHaveBeenCalled();
  });

  it('copyJobRootSeed shells out with env vars when glob is set', async () => {
    const runCommandMock = vi.mocked(runCommand);

    await copyJobRootSeed('templates/*', '/tmp/job-root', { FOO: 'bar' }, '/tmp/runner.log', ['secret']);

    expect(runCommandMock).toHaveBeenCalledTimes(1);
    const [command, args, options] = runCommandMock.mock.calls[0];
    expect(command).toBe('bash');
    expect(args).toEqual(['-lc', expect.any(String)]);
    expect(options).toEqual(expect.objectContaining({
      cwd: '/tmp/job-root',
      logFilePath: '/tmp/runner.log',
      timeoutMs: 60_000,
      redact: ['secret'],
      env: expect.objectContaining({
        FOO: 'bar',
        JOB_ROOT_COPY_GLOB: 'templates/*',
        JOB_ROOT_DEST: '/tmp/job-root',
      }),
    }));
  });

  it('resolveCodexThreadId returns explicit thread id', async () => {
    const loadJobRecordMock = vi.mocked(loadJobRecord);

    const job = {
      jobId: 'job-1',
      type: 'MENTION' as const,
      repoKeys: [],
      gitRef: 'main',
      requestText: 'Hello',
      slack: { channelId: 'C1', userId: 'U1' },
      codexThreadId: 'thread-explicit',
    };

    await expect(resolveCodexThreadId(job)).resolves.toBe('thread-explicit');
    expect(loadJobRecordMock).not.toHaveBeenCalled();
  });

  it('resolveCodexThreadId resolves from resume job record', async () => {
    const loadJobRecordMock = vi.mocked(loadJobRecord);
    const findLatestJobBySlackThreadMock = vi.mocked(findLatestJobBySlackThread);

    loadJobRecordMock.mockResolvedValueOnce({
      job: { codexThreadId: 'thread-resumed' },
    } as any);

    const job = {
      jobId: 'job-2',
      type: 'ASK' as const,
      repoKeys: ['repo-1'],
      gitRef: 'main',
      requestText: 'Hello',
      slack: { channelId: 'C1', userId: 'U1' },
      resumeFromJobId: 'job-1',
    };

    await expect(resolveCodexThreadId(job)).resolves.toBe('thread-resumed');
    expect(loadJobRecordMock).toHaveBeenCalledWith('job-1');
    expect(findLatestJobBySlackThreadMock).not.toHaveBeenCalled();
  });

  it('resolveCodexThreadId falls back to latest thread record', async () => {
    const loadJobRecordMock = vi.mocked(loadJobRecord);
    const findLatestJobBySlackThreadMock = vi.mocked(findLatestJobBySlackThread);

    loadJobRecordMock.mockResolvedValueOnce(undefined);
    findLatestJobBySlackThreadMock.mockResolvedValueOnce({
      job: { codexThreadId: 'thread-latest' },
    } as any);

    const job = {
      jobId: 'job-3',
      type: 'MENTION' as const,
      repoKeys: [],
      gitRef: 'main',
      requestText: 'Hello',
      slack: { channelId: 'C1', userId: 'U1', threadTs: '123.456' },
    };

    await expect(resolveCodexThreadId(job)).resolves.toBe('thread-latest');
    expect(findLatestJobBySlackThreadMock).toHaveBeenCalledWith('C1', '123.456');
  });

  it('resolveMentionWorkingDirectory uses fallback for non-mention jobs', async () => {
    const job = {
      jobId: 'job-4',
      type: 'ASK' as const,
      repoKeys: ['repo-1'],
      gitRef: 'main',
      requestText: 'Hello',
      slack: { channelId: 'C1', userId: 'U1' },
    };

    await expect(resolveMentionWorkingDirectory(job, '/tmp/fallback')).resolves.toBe('/tmp/fallback');
  });

  it('resolveMentionWorkingDirectory uses previous job root when available', async () => {
    const loadJobRecordMock = vi.mocked(loadJobRecord);
    const findLatestJobBySlackThreadAndTypesMock = vi.mocked(findLatestJobBySlackThreadAndTypes);

    loadJobRecordMock.mockResolvedValueOnce({
      job: { slack: { threadTs: '111.222' } },
    } as any);
    findLatestJobBySlackThreadAndTypesMock.mockResolvedValueOnce({
      job: { jobId: 'job-prev' },
    } as any);

    const job = {
      jobId: 'job-5',
      type: 'MENTION' as const,
      repoKeys: [],
      gitRef: 'main',
      requestText: 'Hello',
      slack: { channelId: 'C1', userId: 'U1' },
    };

    await expect(resolveMentionWorkingDirectory(job, '/tmp/fallback')).resolves.toBe(
      '/tmp/sniptail/job-root/job-prev',
    );
  });

  it('resolveMentionWorkingDirectory falls back on lookup failure', async () => {
    const loadJobRecordMock = vi.mocked(loadJobRecord);
    const findLatestJobBySlackThreadAndTypesMock = vi.mocked(findLatestJobBySlackThreadAndTypes);

    loadJobRecordMock.mockResolvedValueOnce({
      job: { slack: { threadTs: '111.222' } },
    } as any);
    findLatestJobBySlackThreadAndTypesMock.mockRejectedValueOnce(new Error('boom'));

    const job = {
      jobId: 'job-6',
      type: 'MENTION' as const,
      repoKeys: [],
      gitRef: 'main',
      requestText: 'Hello',
      slack: { channelId: 'C1', userId: 'U1' },
    };

    await expect(resolveMentionWorkingDirectory(job, '/tmp/fallback')).resolves.toBe('/tmp/fallback');
  });
});

describe('worker/pipeline runJob', () => {
  it('runs a mention job and posts the response', async () => {
    const loadJobRecordMock = vi.mocked(loadJobRecord);
    const updateJobRecordMock = vi.mocked(updateJobRecord);
    const runCodexMock = vi.mocked(runCodex);
    const postMessageMock = vi.mocked(postMessage);
    const buildSlackIdsMock = vi.mocked(buildSlackIds);
    const mkdirMock = vi.mocked(mkdir);
    const writeFileMock = vi.mocked(writeFile);
    const appendFileMock = vi.mocked(appendFile);
    const ensureCloneMock = vi.mocked(ensureClone);

    const job = {
      jobId: 'job-mention',
      type: 'MENTION' as const,
      repoKeys: [],
      gitRef: 'main',
      requestText: 'Hello',
      slack: { channelId: 'C1', userId: 'U1', threadTs: '123.456' },
    };

    loadJobRecordMock.mockResolvedValue({ job } as any);
    updateJobRecordMock.mockResolvedValue(undefined);
    runCodexMock.mockResolvedValue({ threadId: 'thread-1', finalResponse: 'Hello there!' } as any);
    buildSlackIdsMock.mockReturnValue({ actions: {} } as any);
    mkdirMock.mockResolvedValue(undefined);
    writeFileMock.mockResolvedValue(undefined);
    appendFileMock.mockResolvedValue(undefined);

    const result = await runJob({} as App, job);

    expect(result).toEqual({
      jobId: 'job-mention',
      status: 'ok',
      summary: 'Hello there!',
    });
    expect(runCodexMock).toHaveBeenCalledWith(
      job,
      '/tmp/sniptail/repo-cache',
      expect.any(Object),
      expect.objectContaining({
        botName: 'sniptail',
        sandboxMode: 'read-only',
        approvalPolicy: 'on-request',
      }),
    );
    expect(postMessageMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        channel: 'C1',
        text: 'Hello there!',
        threadTs: '123.456',
      }),
    );
    expect(updateJobRecordMock).toHaveBeenCalledWith('job-mention', { status: 'running' });
    expect(updateJobRecordMock).toHaveBeenCalledWith(
      'job-mention',
      expect.objectContaining({ status: 'ok', summary: 'Hello there!' }),
    );
    expect(ensureCloneMock).not.toHaveBeenCalled();
  });
});
