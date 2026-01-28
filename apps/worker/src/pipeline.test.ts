import { describe, expect, it, vi } from 'vitest';

vi.mock('@sniptail/core/config/config.js', () => ({
  loadCoreConfig: () => ({
    repoAllowlist: {},
    jobWorkRoot: '/tmp/sniptail/job-root',
    jobRegistryPath: '/tmp/sniptail/registry',
  }),
  loadWorkerConfig: () => ({
    botName: 'sniptail',
    repoAllowlist: {},
    jobWorkRoot: '/tmp/sniptail/job-root',
    jobRegistryPath: '/tmp/sniptail/registry',
    repoCacheRoot: '/tmp/sniptail/repo-cache',
    jobRootCopyGlob: undefined,
    openAiKey: undefined,
    gitlab: undefined,
    github: undefined,
    redisUrl: 'redis://localhost:6379/0',
    primaryAgent: 'codex',
    copilot: {
      executionMode: 'local',
      idleRetries: 2,
    },
    codex: {
      executionMode: 'local',
      dockerfilePath: undefined,
      dockerImage: undefined,
      dockerBuildContext: undefined,
    },
  }),
}));

vi.mock('@sniptail/core/runner/commandRunner.js', () => ({
  runCommand: vi.fn(),
}));

vi.mock('@sniptail/core/jobs/registry.js', () => ({
  findLatestJobBySlackThread: vi.fn(),
  findLatestJobBySlackThreadAndTypes: vi.fn(),
  loadJobRecord: vi.fn(),
  updateJobRecord: vi.fn(),
}));

vi.mock('@sniptail/core/jobs/utils.js', () => {
  const jobWorkRoot = '/tmp/sniptail/job-root';
  return {
    validateJob: vi.fn(),
    buildJobPaths: (jobId: string) => ({
      root: `${jobWorkRoot}/${jobId}`,
      reposRoot: `${jobWorkRoot}/${jobId}/repos`,
      artifactsRoot: `${jobWorkRoot}/${jobId}/artifacts`,
      logsRoot: `${jobWorkRoot}/${jobId}/logs`,
      logFile: `${jobWorkRoot}/${jobId}/logs/runner.log`,
    }),
    parseReviewerIds: (values?: string[]) => {
      if (!values) return undefined;
      const ids = values
        .map((value) => Number.parseInt(value, 10))
        .filter((value) => Number.isFinite(value));
      return ids.length ? ids : undefined;
    },
  };
});

vi.mock('@sniptail/core/agents/agentRegistry.js', () => ({
  AGENT_REGISTRY: {
    codex: { run: vi.fn() },
    copilot: { run: vi.fn() },
  },
}));

vi.mock('@sniptail/core/git/mirror.js', () => ({
  ensureClone: vi.fn(),
}));

vi.mock('@sniptail/core/git/worktree.js', () => ({
  addWorktree: vi.fn(),
  removeWorktree: vi.fn(),
}));

vi.mock('@sniptail/core/git/jobOps.js', () => ({
  commitAndPush: vi.fn(),
  ensureCleanRepo: vi.fn(),
  runChecks: vi.fn(),
}));

vi.mock('@sniptail/core/queue/queue.js', () => ({
  enqueueBotEvent: vi.fn(),
}));

vi.mock('@sniptail/core/slack/ids.js', () => ({
  buildSlackIds: vi.fn(),
}));

vi.mock('@sniptail/core/slack/blocks.js', () => ({
  buildCompletionBlocks: vi.fn(),
}));

vi.mock('@sniptail/core/logger.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('@sniptail/core/github/client.js', () => ({
  createPullRequest: vi.fn(),
}));

vi.mock('@sniptail/core/gitlab/client.js', () => ({
  createMergeRequest: vi.fn(),
}));

vi.mock('node:fs/promises', () => ({
  appendFile: vi.fn(),
  mkdir: vi.fn(),
  readFile: vi.fn(),
  rm: vi.fn(),
  writeFile: vi.fn(),
}));

import { appendFile, mkdir, writeFile } from 'node:fs/promises';
import type { Queue } from 'bullmq';
import { AGENT_REGISTRY } from '@sniptail/core/agents/agentRegistry.js';
import { ensureClone } from '@sniptail/core/git/mirror.js';
import type { JobRecord } from '@sniptail/core/jobs/registry.js';
import {
  findLatestJobBySlackThread,
  findLatestJobBySlackThreadAndTypes,
  loadJobRecord,
  updateJobRecord,
} from '@sniptail/core/jobs/registry.js';
import { enqueueBotEvent } from '@sniptail/core/queue/queue.js';
import type { RunOptions } from '@sniptail/core/runner/commandRunner.js';
import { runCommand } from '@sniptail/core/runner/commandRunner.js';
import { buildSlackIds } from '@sniptail/core/slack/ids.js';
import type { SlackIds } from '@sniptail/core/slack/ids.js';
import type { BotEvent } from '@sniptail/core/types/bot-event.js';
import {
  copyJobRootSeed,
  resolveAgentThreadId,
  resolveMentionWorkingDirectory,
  runJob,
} from './pipeline.js';

describe('worker/pipeline helpers', () => {
  it('copyJobRootSeed skips when glob is empty', async () => {
    const runCommandMock = vi.mocked(runCommand);

    await copyJobRootSeed('   ', '/tmp/job-root', {}, '/tmp/runner.log', []);

    expect(runCommandMock).not.toHaveBeenCalled();
  });

  it('copyJobRootSeed shells out with env vars when glob is set', async () => {
    const runCommandMock = vi.mocked(runCommand);

    await copyJobRootSeed('templates/*', '/tmp/job-root', { FOO: 'bar' }, '/tmp/runner.log', [
      'secret',
    ]);

    expect(runCommandMock).toHaveBeenCalledTimes(1);
    const [command, args, options] = runCommandMock.mock.calls[0]!;
    expect(command).toBe('bash');
    expect(args).toEqual(['-lc', expect.any(String)]);
    expect(options).toEqual(
      expect.objectContaining({
        cwd: '/tmp/job-root',
        logFilePath: '/tmp/runner.log',
        timeoutMs: 60_000,
        redact: ['secret'],
        env: expect.objectContaining({
          FOO: 'bar',
          JOB_ROOT_COPY_GLOB: 'templates/*',
          JOB_ROOT_DEST: '/tmp/job-root',
        }) as RunOptions['env'],
      }),
    );
  });

  it('resolveAgentThreadId returns explicit thread id', async () => {
    const loadJobRecordMock = vi.mocked(loadJobRecord);

    const job = {
      jobId: 'job-1',
      type: 'MENTION' as const,
      repoKeys: [],
      gitRef: 'main',
      requestText: 'Hello',
      slack: { channelId: 'C1', userId: 'U1' },
      agentThreadIds: { codex: 'thread-explicit' },
    };

    await expect(resolveAgentThreadId(job, 'codex')).resolves.toBe('thread-explicit');
    expect(loadJobRecordMock).not.toHaveBeenCalled();
  });

  it('resolveAgentThreadId resolves from resume job record', async () => {
    const loadJobRecordMock = vi.mocked(loadJobRecord);
    const findLatestJobBySlackThreadMock = vi.mocked(findLatestJobBySlackThread);

    loadJobRecordMock.mockResolvedValueOnce({
      job: { agentThreadIds: { codex: 'thread-resumed' } },
    } as JobRecord);

    const job = {
      jobId: 'job-2',
      type: 'ASK' as const,
      repoKeys: ['repo-1'],
      gitRef: 'main',
      requestText: 'Hello',
      slack: { channelId: 'C1', userId: 'U1' },
      resumeFromJobId: 'job-1',
    };

    await expect(resolveAgentThreadId(job, 'codex')).resolves.toBe('thread-resumed');
    expect(loadJobRecordMock).toHaveBeenCalledWith('job-1');
    expect(findLatestJobBySlackThreadMock).not.toHaveBeenCalled();
  });

  it('resolveAgentThreadId falls back to latest thread record', async () => {
    const loadJobRecordMock = vi.mocked(loadJobRecord);
    const findLatestJobBySlackThreadMock = vi.mocked(findLatestJobBySlackThread);

    loadJobRecordMock.mockResolvedValueOnce(undefined);
    findLatestJobBySlackThreadMock.mockResolvedValueOnce({
      job: { agentThreadIds: { codex: 'thread-latest' } },
    } as JobRecord);

    const job = {
      jobId: 'job-3',
      type: 'MENTION' as const,
      repoKeys: [],
      gitRef: 'main',
      requestText: 'Hello',
      slack: { channelId: 'C1', userId: 'U1', threadTs: '123.456' },
    };

    await expect(resolveAgentThreadId(job, 'codex')).resolves.toBe('thread-latest');
    expect(findLatestJobBySlackThreadMock).toHaveBeenCalledWith('C1', '123.456', 'codex');
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

    await expect(resolveMentionWorkingDirectory(job, '/tmp/fallback')).resolves.toBe(
      '/tmp/fallback',
    );
  });

  it('resolveMentionWorkingDirectory uses previous job root when available', async () => {
    const loadJobRecordMock = vi.mocked(loadJobRecord);
    const findLatestJobBySlackThreadAndTypesMock = vi.mocked(findLatestJobBySlackThreadAndTypes);

    loadJobRecordMock.mockResolvedValueOnce({
      job: { slack: { threadTs: '111.222' } },
    } as JobRecord);
    findLatestJobBySlackThreadAndTypesMock.mockResolvedValueOnce({
      job: { jobId: 'job-prev' },
    } as JobRecord);

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
    } as JobRecord);
    findLatestJobBySlackThreadAndTypesMock.mockRejectedValueOnce(new Error('boom'));

    const job = {
      jobId: 'job-6',
      type: 'MENTION' as const,
      repoKeys: [],
      gitRef: 'main',
      requestText: 'Hello',
      slack: { channelId: 'C1', userId: 'U1' },
    };

    await expect(resolveMentionWorkingDirectory(job, '/tmp/fallback')).resolves.toBe(
      '/tmp/fallback',
    );
  });
});

describe('worker/pipeline runJob', () => {
  it('runs a mention job and posts the response', async () => {
    const loadJobRecordMock = vi.mocked(loadJobRecord);
    const updateJobRecordMock = vi.mocked(updateJobRecord);
    const runAgentMock = vi.mocked(AGENT_REGISTRY.codex.run);
    const enqueueBotEventMock = vi.mocked(enqueueBotEvent);
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

    loadJobRecordMock.mockResolvedValue({ job } as unknown as JobRecord);
    updateJobRecordMock.mockResolvedValue({} as JobRecord);
    const agentResult = {
      threadId: 'thread-1',
      finalResponse: 'Hello there!',
    };
    const slackIds: SlackIds = {
      commandPrefix: 'sniptail',
      commands: {
        ask: '/sniptail-ask',
        implement: '/sniptail-implement',
        clearBefore: '/sniptail-clear-before',
        usage: '/sniptail-usage',
      },
      actions: {
        askFromJob: 'sniptail-ask-from-job',
        implementFromJob: 'sniptail-implement-from-job',
        worktreeCommands: 'sniptail-worktree-commands',
        clearJob: 'sniptail-clear-job',
        askSubmit: 'sniptail-ask-submit',
        implementSubmit: 'sniptail-implement-submit',
      },
    };

    runAgentMock.mockResolvedValue(agentResult);
    buildSlackIdsMock.mockReturnValue(slackIds);
    mkdirMock.mockResolvedValue(undefined);
    writeFileMock.mockResolvedValue(undefined);
    appendFileMock.mockResolvedValue(undefined);

    const botQueue = {} as Queue<BotEvent>;
    const result = await runJob(botQueue, job);

    expect(result).toEqual({
      jobId: 'job-mention',
      status: 'ok',
      summary: 'Hello there!',
    });
    expect(runAgentMock).toHaveBeenCalledWith(
      job,
      '/tmp/sniptail/repo-cache',
      expect.any(Object),
      expect.objectContaining({
        botName: 'sniptail',
        sandboxMode: 'read-only',
        approvalPolicy: 'on-request',
      }),
    );
    expect(enqueueBotEventMock).toHaveBeenCalledWith(
      botQueue,
      expect.objectContaining({
        type: 'postMessage',
        payload: expect.objectContaining({
          channel: 'C1',
          text: 'Hello there!',
          threadTs: '123.456',
        }) as {
          channel: string;
          text: string;
          threadTs?: string;
          blocks?: unknown[];
        },
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
