import { describe, expect, it, vi } from 'vitest';

vi.mock('@sniptail/core/config/config.js', () => ({
  loadCoreConfig: () => ({
    repoAllowlistPath: '/tmp/sniptail/allowlist.json',
    repoAllowlist: {},
    jobWorkRoot: '/tmp/sniptail/job-root',
    jobRegistryPath: '/tmp/sniptail/registry',
    jobRegistryDriver: 'sqlite',
  }),
  loadWorkerConfig: () => ({
    botName: 'sniptail',
    repoAllowlistPath: '/tmp/sniptail/allowlist.json',
    repoAllowlist: {},
    jobWorkRoot: '/tmp/sniptail/job-root',
    jobRegistryPath: '/tmp/sniptail/registry',
    jobRegistryDriver: 'sqlite',
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

vi.mock('@sniptail/core/repos/catalog.js', () => ({
  loadRepoAllowlistFromCatalog: vi.fn(() =>
    Promise.resolve({
      'repo-1': { sshUrl: 'git@example.com:org/repo-1.git', projectId: 1, baseBranch: 'main' },
      'repo-2': { sshUrl: 'git@example.com:org/repo-2.git', projectId: 2, baseBranch: 'main' },
    }),
  ),
}));

vi.mock('@sniptail/core/runner/commandRunner.js', () => ({
  runCommand: vi.fn(),
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

vi.mock('@sniptail/core/agents/agentRegistry.js', () => {
  const codexRun = vi.fn();
  const copilotRun = vi.fn();
  return {
    AGENT_DESCRIPTORS: {
      codex: {
        id: 'codex',
        adapter: { run: codexRun },
        isDockerMode: () => false,
        resolveModelConfig: () => undefined,
        shouldIncludeRepoCache: () => false,
        buildRunOptions: () => ({}),
      },
      copilot: {
        id: 'copilot',
        adapter: { run: copilotRun },
        isDockerMode: () => false,
        resolveModelConfig: () => undefined,
        shouldIncludeRepoCache: () => false,
        buildRunOptions: () => ({}),
      },
    },
  };
});

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
import { AGENT_DESCRIPTORS } from '@sniptail/core/agents/agentRegistry.js';
import { ensureClone } from '@sniptail/core/git/mirror.js';
import type { JobRecord } from '@sniptail/core/jobs/registry.js';
import { enqueueBotEvent } from '@sniptail/core/queue/queue.js';
import type { RunOptions } from '@sniptail/core/runner/commandRunner.js';
import { runCommand } from '@sniptail/core/runner/commandRunner.js';
import type { BotEvent } from '@sniptail/core/types/bot-event.js';
import {
  copyJobRootSeed,
  resolveAgentThreadId,
  resolveMentionWorkingDirectory,
  runJob,
} from './pipeline.js';
import { BullMqBotEventSink } from './channels/botEventSink.js';
import type { JobRegistry } from './job/jobRegistry.js';

function createRegistryMock() {
  return {
    loadJobRecord: vi.fn(),
    updateJobRecord: vi.fn(),
    loadAllJobRecords: vi.fn(),
    deleteJobRecords: vi.fn(),
    markJobForDeletion: vi.fn(),
    clearJobsBefore: vi.fn(),
    findLatestJobByChannelThread: vi.fn(),
    findLatestJobByChannelThreadAndTypes: vi.fn(),
  } satisfies JobRegistry;
}

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
    const registry = createRegistryMock();
    const loadJobRecordMock = registry.loadJobRecord;

    const job = {
      jobId: 'job-1',
      type: 'MENTION' as const,
      repoKeys: [],
      gitRef: 'main',
      requestText: 'Hello',
      channel: { provider: 'slack', channelId: 'C1', userId: 'U1' },
      agentThreadIds: { codex: 'thread-explicit' },
    };

    await expect(resolveAgentThreadId(job, 'codex', registry)).resolves.toBe('thread-explicit');
    expect(loadJobRecordMock).not.toHaveBeenCalled();
  });

  it('resolveAgentThreadId resolves from resume job record', async () => {
    const registry = createRegistryMock();
    const loadJobRecordMock = registry.loadJobRecord;
    const findLatestJobByChannelThreadMock = registry.findLatestJobByChannelThread;

    loadJobRecordMock.mockResolvedValueOnce({
      job: { agentThreadIds: { codex: 'thread-resumed' } },
    } as JobRecord);

    const job = {
      jobId: 'job-2',
      type: 'ASK' as const,
      repoKeys: ['repo-1'],
      gitRef: 'main',
      requestText: 'Hello',
      channel: { provider: 'slack', channelId: 'C1', userId: 'U1' },
      resumeFromJobId: 'job-1',
    };

    await expect(resolveAgentThreadId(job, 'codex', registry)).resolves.toBe('thread-resumed');
    expect(loadJobRecordMock).toHaveBeenCalledWith('job-1');
    expect(findLatestJobByChannelThreadMock).not.toHaveBeenCalled();
  });

  it('resolveAgentThreadId falls back to latest thread record', async () => {
    const registry = createRegistryMock();
    const loadJobRecordMock = registry.loadJobRecord;
    const findLatestJobByChannelThreadMock = registry.findLatestJobByChannelThread;

    loadJobRecordMock.mockResolvedValueOnce(undefined);
    findLatestJobByChannelThreadMock.mockResolvedValueOnce({
      job: { agentThreadIds: { codex: 'thread-latest' } },
    } as JobRecord);

    const job = {
      jobId: 'job-3',
      type: 'MENTION' as const,
      repoKeys: [],
      gitRef: 'main',
      requestText: 'Hello',
      channel: { provider: 'slack', channelId: 'C1', userId: 'U1', threadId: '123.456' },
    };

    await expect(resolveAgentThreadId(job, 'codex', registry)).resolves.toBe('thread-latest');
    expect(findLatestJobByChannelThreadMock).toHaveBeenCalledWith(
      'slack',
      'C1',
      '123.456',
      'codex',
    );
  });

  it('resolveMentionWorkingDirectory uses fallback for non-mention jobs', async () => {
    const registry = createRegistryMock();
    const job = {
      jobId: 'job-4',
      type: 'ASK' as const,
      repoKeys: ['repo-1'],
      gitRef: 'main',
      requestText: 'Hello',
      channel: { provider: 'slack', channelId: 'C1', userId: 'U1' },
    };

    await expect(resolveMentionWorkingDirectory(job, '/tmp/fallback', registry)).resolves.toBe(
      '/tmp/fallback',
    );
  });

  it('resolveMentionWorkingDirectory uses previous job root when available', async () => {
    const registry = createRegistryMock();
    const loadJobRecordMock = registry.loadJobRecord;
    const findLatestJobByChannelThreadAndTypesMock = registry.findLatestJobByChannelThreadAndTypes;

    loadJobRecordMock.mockResolvedValueOnce({
      job: { channel: { provider: 'slack', threadId: '111.222', channelId: 'C1', userId: 'U1' } },
    } as JobRecord);
    findLatestJobByChannelThreadAndTypesMock.mockResolvedValueOnce({
      job: { jobId: 'job-prev' },
    } as JobRecord);

    const job = {
      jobId: 'job-5',
      type: 'MENTION' as const,
      repoKeys: [],
      gitRef: 'main',
      requestText: 'Hello',
      channel: { provider: 'slack', channelId: 'C1', userId: 'U1' },
    };

    await expect(resolveMentionWorkingDirectory(job, '/tmp/fallback', registry)).resolves.toBe(
      '/tmp/sniptail/job-root/job-prev',
    );
    expect(findLatestJobByChannelThreadAndTypesMock).toHaveBeenCalledWith(
      'slack',
      'C1',
      '111.222',
      ['ASK', 'PLAN', 'IMPLEMENT'],
    );
  });

  it('resolveMentionWorkingDirectory falls back on lookup failure', async () => {
    const registry = createRegistryMock();
    const loadJobRecordMock = registry.loadJobRecord;
    const findLatestJobByChannelThreadAndTypesMock = registry.findLatestJobByChannelThreadAndTypes;

    loadJobRecordMock.mockResolvedValueOnce({
      job: { channel: { provider: 'slack', threadId: '111.222', channelId: 'C1', userId: 'U1' } },
    } as JobRecord);
    findLatestJobByChannelThreadAndTypesMock.mockRejectedValueOnce(new Error('boom'));

    const job = {
      jobId: 'job-6',
      type: 'MENTION' as const,
      repoKeys: [],
      gitRef: 'main',
      requestText: 'Hello',
      channel: { provider: 'slack', channelId: 'C1', userId: 'U1' },
    };

    await expect(resolveMentionWorkingDirectory(job, '/tmp/fallback', registry)).resolves.toBe(
      '/tmp/fallback',
    );
  });
});

describe('worker/pipeline runJob', () => {
  it('runs a mention job and posts the response', async () => {
    const registry = createRegistryMock();
    const loadJobRecordMock = registry.loadJobRecord;
    const updateJobRecordMock = registry.updateJobRecord;
    const runAgentMock = vi.mocked(AGENT_DESCRIPTORS.codex.adapter.run);
    const enqueueBotEventMock = vi.mocked(enqueueBotEvent);
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
      channel: { provider: 'slack', channelId: 'C1', userId: 'U1', threadId: '123.456' },
    };

    loadJobRecordMock.mockResolvedValue({ job } as unknown as JobRecord);
    updateJobRecordMock.mockResolvedValue({} as JobRecord);
    const agentResult = {
      threadId: 'thread-1',
      finalResponse: 'Hello there!',
    };
    runAgentMock.mockResolvedValue(agentResult);
    mkdirMock.mockResolvedValue(undefined);
    writeFileMock.mockResolvedValue(undefined);
    appendFileMock.mockResolvedValue(undefined);

    const botQueue = {} as Queue<BotEvent>;
    const result = await runJob(new BullMqBotEventSink(botQueue), job, registry);

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
        provider: 'slack',
        type: 'postMessage',
        payload: expect.objectContaining({
          channelId: 'C1',
          text: 'Hello there!',
          threadId: '123.456',
        }) as {
          channelId: string;
          text: string;
          threadId?: string;
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
