import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@sniptail/core/config/config.js', () => ({
  loadCoreConfig: () => ({
    repoAllowlistPath: '/tmp/sniptail/allowlist.json',
    repoAllowlist: {},
    jobWorkRoot: '/tmp/sniptail/job-root',
    queueDriver: 'redis',
    jobRegistryPath: '/tmp/sniptail/registry',
    jobRegistryDriver: 'sqlite',
  }),
  loadWorkerConfig: () => ({
    botName: 'sniptail',
    repoAllowlistPath: '/tmp/sniptail/allowlist.json',
    repoAllowlist: {},
    jobWorkRoot: '/tmp/sniptail/job-root',
    queueDriver: 'redis',
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
    run: {
      actions: {
        'refresh-docs': {
          timeoutMs: 600_000,
          allowFailure: false,
          gitMode: 'execution-only',
          fallbackCommand: ['pnpm', 'docs:refresh'],
        },
        'refresh-with-mr': {
          timeoutMs: 600_000,
          allowFailure: false,
          gitMode: 'implement',
          checks: ['npm-lint'],
          fallbackCommand: ['pnpm', 'docs:refresh'],
        },
        'refresh-allow-failure': {
          timeoutMs: 600_000,
          allowFailure: true,
          gitMode: 'execution-only',
          fallbackCommand: ['pnpm', 'docs:refresh'],
        },
      },
    },
  }),
}));

vi.mock('@sniptail/core/repos/catalog.js', () => ({
  loadRepoAllowlistFromCatalog: vi.fn(() =>
    Promise.resolve({
      'repo-1': {
        sshUrl: 'git@example.com:org/repo-1.git',
        projectId: 1,
        baseBranch: 'main',
        providerData: {
          sniptail: {
            run: {
              actions: {
                'refresh-docs': { parameters: [], steps: [] },
                'refresh-with-mr': { parameters: [], steps: [] },
                'refresh-allow-failure': { parameters: [], steps: [] },
              },
              syncedAt: '2026-03-01T00:00:00.000Z',
              sourceRef: 'main',
            },
          },
        },
      },
      'repo-2': {
        sshUrl: 'git@example.com:org/repo-2.git',
        projectId: 2,
        baseBranch: 'main',
        providerData: {
          sniptail: {
            run: {
              actions: {
                'refresh-docs': { parameters: [], steps: [] },
                'refresh-with-mr': { parameters: [], steps: [] },
                'refresh-allow-failure': { parameters: [], steps: [] },
              },
              syncedAt: '2026-03-01T00:00:00.000Z',
              sourceRef: 'main',
            },
          },
        },
      },
    }),
  ),
}));

vi.mock('@sniptail/core/repos/providers.js', () => ({
  createRepoReviewRequest: vi.fn(() =>
    Promise.resolve({
      url: 'https://example.com/review/1',
      iid: 1,
    }),
  ),
  inferRepoProvider: vi.fn(() => 'gitlab'),
}));

vi.mock('@sniptail/core/repos/runActions.js', () => ({
  normalizeRunActionId: vi.fn((value: string) => value.trim()),
  normalizeRunActionParams: vi.fn((params: unknown) => ({
    normalized: (params as Record<string, unknown> | undefined) ?? {},
    sensitiveValues: [],
  })),
  resolveRunActionMetadataForRepos: vi.fn(() => ({
    parameters: [],
  })),
}));

vi.mock('../src/channels/workerChannelAdapters.js', () => ({
  resolveWorkerChannelAdapter: vi.fn(() => ({
    buildPostMessageEvent: (ref: { channelId: string; threadId?: string }, text: string) => ({
      schemaVersion: 1,
      provider: 'slack',
      type: 'message.post',
      payload: {
        channelId: ref.channelId,
        text,
        ...(ref.threadId ? { threadId: ref.threadId } : {}),
      },
    }),
    buildUploadFileEvent: (
      ref: { channelId: string; threadId?: string },
      file: { title: string; fileContent?: string },
    ) => ({
      schemaVersion: 1,
      provider: 'slack',
      type: 'file.upload',
      payload: {
        channelId: ref.channelId,
        title: file.title,
        ...(file.fileContent ? { fileContent: file.fileContent } : {}),
        ...(ref.threadId ? { threadId: ref.threadId } : {}),
      },
    }),
    renderCompletionMessage: ({
      text,
      openQuestions,
    }: {
      text: string;
      openQuestions?: string[];
    }) => ({
      text: openQuestions?.length ? `${text}\n${openQuestions.join('\n')}` : text,
      options: undefined,
    }),
  })),
}));

vi.mock('../channels/workerChannelAdapters.js', () => ({
  resolveWorkerChannelAdapter: vi.fn(() => ({
    buildPostMessageEvent: (ref: { channelId: string; threadId?: string }, text: string) => ({
      schemaVersion: 1,
      provider: 'slack',
      type: 'message.post',
      payload: {
        channelId: ref.channelId,
        text,
        ...(ref.threadId ? { threadId: ref.threadId } : {}),
      },
    }),
    buildUploadFileEvent: (
      ref: { channelId: string; threadId?: string },
      file: { title: string; fileContent?: string },
    ) => ({
      schemaVersion: 1,
      provider: 'slack',
      type: 'file.upload',
      payload: {
        channelId: ref.channelId,
        title: file.title,
        ...(file.fileContent ? { fileContent: file.fileContent } : {}),
        ...(ref.threadId ? { threadId: ref.threadId } : {}),
      },
    }),
    renderCompletionMessage: ({
      text,
      openQuestions,
    }: {
      text: string;
      openQuestions?: string[];
    }) => ({
      text: openQuestions?.length ? `${text}\n${openQuestions.join('\n')}` : text,
      options: undefined,
    }),
  })),
}));

vi.mock('@sniptail/core/runner/commandRunner.js', () => ({
  CommandError: class MockCommandError extends Error {
    readonly result: unknown;

    constructor(message: string, result: unknown) {
      super(message);
      this.name = 'CommandError';
      this.result = result;
    }
  },
  runCommand: vi.fn(),
}));

vi.mock('@sniptail/core/jobs/utils.js', () => {
  const jobWorkRoot = '/tmp/sniptail/job-root';
  return {
    validateJob: vi.fn(),
    buildJobPaths: (_jobRoot: string, jobId: string) => ({
      root: `${jobWorkRoot}/${jobId}`,
      reposRoot: `${jobWorkRoot}/${jobId}/repos`,
      contextRoot: `${jobWorkRoot}/${jobId}/context`,
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

vi.mock('@sniptail/core/agents/buildPrompt.js', () => ({
  buildPromptForJobWithLineageWarnings: vi.fn(
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    (_job: unknown, _botName: string, _warnings: unknown[]) => 'prompt with lineage warning',
  ),
}));

vi.mock('@sniptail/core/codex/prompts.js', () => ({
  buildImplementArtifactsPrompt: vi.fn(() => 'implement artifacts prompt'),
}));

vi.mock('@sniptail/core/utils/slack.js', () => ({
  toSlackCommandPrefix: vi.fn(() => 'sniptail'),
}));

vi.mock('@sniptail/core/utils/text.js', () => ({
  clampText: vi.fn((value: string) => value),
  firstContentLine: vi.fn((value: string) => value.split('\n').find(Boolean) ?? ''),
  wrapText: vi.fn((value: string) => value),
}));

vi.mock('@sniptail/core/git/mirror.js', () => ({
  ensureClone: vi.fn(),
}));

vi.mock('@sniptail/core/git/branch.js', () => ({
  toGitBranchPrefix: vi.fn(() => 'sniptail'),
}));

vi.mock('@sniptail/core/git/worktree.js', () => ({
  addWorktree: vi.fn(),
  removeWorktree: vi.fn(),
}));

vi.mock('@sniptail/core/git/jobOps.js', () => ({
  commitAndPush: vi.fn(),
  commitAndPushLineage: vi.fn(),
  ensureCleanRepo: vi.fn(),
  resolveGitRef: vi.fn(),
  runNamedRunContractDetailed: vi.fn(),
  runSetupContract: vi.fn(),
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
  copyFile: vi.fn(),
  mkdir: vi.fn(),
  readdir: vi.fn(),
  readFile: vi.fn(),
  rm: vi.fn(),
  writeFile: vi.fn(),
}));

import type { Dirent } from 'node:fs';
import { constants } from 'node:fs';
import { appendFile, copyFile, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { AGENT_DESCRIPTORS } from '@sniptail/core/agents/agentRegistry.js';
import {
  commitAndPushLineage,
  resolveGitRef,
  runChecks,
  runNamedRunContractDetailed,
} from '@sniptail/core/git/jobOps.js';
import { ensureClone } from '@sniptail/core/git/mirror.js';
import { addWorktree } from '@sniptail/core/git/worktree.js';
import type { JobRecord } from '@sniptail/core/jobs/registry.js';
import { enqueueBotEvent } from '@sniptail/core/queue/queue.js';
import type { QueuePublisher } from '@sniptail/core/queue/queueTransportTypes.js';
import { loadRepoAllowlistFromCatalog } from '@sniptail/core/repos/catalog.js';
import { createRepoReviewRequest } from '@sniptail/core/repos/providers.js';
import type { RunOptions } from '@sniptail/core/runner/commandRunner.js';
import { CommandError, runCommand } from '@sniptail/core/runner/commandRunner.js';
import { buildCompletionBlocks } from '@sniptail/core/slack/blocks.js';
import { buildSlackIds } from '@sniptail/core/slack/ids.js';
import type { BotEvent } from '@sniptail/core/types/bot-event.js';
import {
  copyArtifactsFromResumedJob,
  copyContextFromResumedJob,
  copyJobRootSeed,
  materializeJobContextFiles,
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

function createDirent(name: string, isFile: boolean): Dirent {
  return { name, isFile: () => isFile } as unknown as Dirent;
}

function createJobPaths(jobId: string) {
  return {
    root: `/tmp/sniptail/job-root/${jobId}`,
    reposRoot: `/tmp/sniptail/job-root/${jobId}/repos`,
    contextRoot: `/tmp/sniptail/job-root/${jobId}/context`,
    artifactsRoot: `/tmp/sniptail/job-root/${jobId}/artifacts`,
    logsRoot: `/tmp/sniptail/job-root/${jobId}/logs`,
    logFile: `/tmp/sniptail/job-root/${jobId}/logs/runner.log`,
  } as never;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }
  return value as Record<string, unknown>;
}

function getLatestSlackMessagePostText(): string {
  const calls = vi.mocked(enqueueBotEvent).mock.calls;
  for (let index = calls.length - 1; index >= 0; index -= 1) {
    const event = asRecord(calls[index]?.[1]);
    if (!event) {
      continue;
    }
    if (event.provider !== 'slack' || event.type !== 'message.post') {
      continue;
    }
    const payload = asRecord(event.payload);
    if (typeof payload?.text === 'string') {
      return payload.text;
    }
  }
  throw new Error('Expected a slack message.post event with text payload.');
}

function getWriteFileContentForPath(targetPath: string): string {
  const calls = vi.mocked(writeFile).mock.calls;
  for (let index = calls.length - 1; index >= 0; index -= 1) {
    const call = calls[index];
    const filePath = call?.[0];
    const content = call?.[1];
    if (filePath === targetPath && typeof content === 'string') {
      return content;
    }
  }
  throw new Error(`Expected writeFile call for ${targetPath}`);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(appendFile).mockResolvedValue(undefined);
  vi.mocked(copyFile).mockResolvedValue(undefined);
  vi.mocked(mkdir).mockResolvedValue(undefined);
  vi.mocked(readdir).mockResolvedValue([]);
  vi.mocked(resolveGitRef).mockResolvedValue('abc123');
  vi.mocked(writeFile).mockResolvedValue(undefined);
});

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

  it('copyArtifactsFromResumedJob copies regular files and skips job-spec', async () => {
    const readdirMock = vi.mocked(readdir);
    const copyFileMock = vi.mocked(copyFile);

    readdirMock.mockResolvedValueOnce([
      createDirent('plan.md', true),
      createDirent('job-spec.json', true),
      createDirent('attachments', false),
    ] as never);
    copyFileMock.mockResolvedValueOnce(undefined);

    await copyArtifactsFromResumedJob(
      'job-prev',
      '/tmp/sniptail/job-root',
      createJobPaths('job-next'),
    );

    expect(readdirMock).toHaveBeenCalledWith('/tmp/sniptail/job-root/job-prev/artifacts', {
      withFileTypes: true,
    });
    expect(copyFileMock).toHaveBeenCalledTimes(1);
    expect(copyFileMock).toHaveBeenCalledWith(
      '/tmp/sniptail/job-root/job-prev/artifacts/plan.md',
      '/tmp/sniptail/job-root/job-next/artifacts/plan.md',
      constants.COPYFILE_EXCL,
    );
  });

  it('copyArtifactsFromResumedJob skips when source artifact path is missing', async () => {
    const readdirMock = vi.mocked(readdir);
    const copyFileMock = vi.mocked(copyFile);

    readdirMock.mockRejectedValueOnce(
      Object.assign(new Error('missing artifacts path'), { code: 'ENOENT' }),
    );

    await expect(
      copyArtifactsFromResumedJob('job-prev', '/tmp/sniptail/job-root', createJobPaths('job-next')),
    ).resolves.toBeUndefined();

    expect(copyFileMock).not.toHaveBeenCalled();
  });

  it('copyArtifactsFromResumedJob ignores destination collisions', async () => {
    const readdirMock = vi.mocked(readdir);
    const copyFileMock = vi.mocked(copyFile);

    readdirMock.mockResolvedValueOnce([createDirent('plan.md', true)] as never);
    copyFileMock.mockRejectedValueOnce(Object.assign(new Error('exists'), { code: 'EEXIST' }));

    await expect(
      copyArtifactsFromResumedJob('job-prev', '/tmp/sniptail/job-root', createJobPaths('job-next')),
    ).resolves.toBeUndefined();
  });

  it('copyContextFromResumedJob copies context files and manifest', async () => {
    const readdirMock = vi.mocked(readdir);
    const copyFileMock = vi.mocked(copyFile);

    readdirMock.mockResolvedValueOnce([
      createDirent('manifest.json', true),
      createDirent('diagram.png', true),
      createDirent('nested', false),
    ] as never);
    copyFileMock.mockResolvedValue(undefined);

    await copyContextFromResumedJob(
      'job-prev',
      '/tmp/sniptail/job-root',
      createJobPaths('job-next'),
    );

    expect(readdirMock).toHaveBeenCalledWith('/tmp/sniptail/job-root/job-prev/context', {
      withFileTypes: true,
    });
    expect(copyFileMock).toHaveBeenCalledTimes(2);
    expect(copyFileMock).toHaveBeenCalledWith(
      '/tmp/sniptail/job-root/job-prev/context/manifest.json',
      '/tmp/sniptail/job-root/job-next/context/manifest.json',
      constants.COPYFILE_EXCL,
    );
    expect(copyFileMock).toHaveBeenCalledWith(
      '/tmp/sniptail/job-root/job-prev/context/diagram.png',
      '/tmp/sniptail/job-root/job-next/context/diagram.png',
      constants.COPYFILE_EXCL,
    );
  });

  it('materializeJobContextFiles writes files and updates manifest', async () => {
    const readdirMock = vi.mocked(readdir);
    const readFileMock = vi.mocked(readFile);
    const writeFileMock = vi.mocked(writeFile);

    readdirMock.mockResolvedValueOnce([
      createDirent('existing.txt', true),
      createDirent('manifest.json', true),
    ] as never);
    readFileMock.mockResolvedValueOnce(
      JSON.stringify({
        version: 1,
        generatedAt: '2026-03-01T00:00:00.000Z',
        files: [
          {
            path: 'context/existing.txt',
            storedName: 'existing.txt',
            originalName: 'existing.txt',
            mediaType: 'text/plain',
            byteSize: 3,
          },
        ],
      }),
    );
    writeFileMock.mockResolvedValue(undefined);

    const newEntries = await materializeJobContextFiles(createJobPaths('job-next'), {
      jobId: 'job-next',
      type: 'ASK',
      repoKeys: ['repo-1'],
      gitRef: 'main',
      requestText: 'Use the files',
      channel: { provider: 'slack', channelId: 'C1', userId: 'U1' },
      contextFiles: [
        {
          originalName: 'Design Diagram.png',
          mediaType: 'image/png',
          byteSize: 7,
          contentBase64: Buffer.from('pngdata').toString('base64'),
          source: { provider: 'slack', externalId: 'F123' },
        },
      ],
    } as never);

    expect(newEntries).toEqual([
      expect.objectContaining({
        path: 'context/Design-Diagram.png',
        storedName: 'Design-Diagram.png',
        originalName: 'Design Diagram.png',
        mediaType: 'image/png',
        byteSize: 7,
      }),
    ]);
    expect(writeFileMock).toHaveBeenCalledTimes(2);
    expect(writeFileMock).toHaveBeenNthCalledWith(
      1,
      '/tmp/sniptail/job-root/job-next/context/Design-Diagram.png',
      Buffer.from('pngdata'),
    );
    expect(writeFileMock).toHaveBeenNthCalledWith(
      2,
      '/tmp/sniptail/job-root/job-next/context/manifest.json',
      expect.stringContaining('context/Design-Diagram.png'),
      'utf8',
    );
    expect(
      getWriteFileContentForPath('/tmp/sniptail/job-root/job-next/context/manifest.json'),
    ).toContain('context/existing.txt');
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

    await expect(
      resolveMentionWorkingDirectory(job, '/tmp/fallback', registry, '/tmp/sniptail/job-root'),
    ).resolves.toBe('/tmp/fallback');
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

    await expect(
      resolveMentionWorkingDirectory(job, '/tmp/fallback', registry, '/tmp/sniptail/job-root'),
    ).resolves.toBe('/tmp/sniptail/job-root/job-prev');
    expect(findLatestJobByChannelThreadAndTypesMock).toHaveBeenCalledWith(
      'slack',
      'C1',
      '111.222',
      ['ASK', 'EXPLORE', 'PLAN', 'IMPLEMENT'],
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

    await expect(
      resolveMentionWorkingDirectory(job, '/tmp/fallback', registry, '/tmp/sniptail/job-root'),
    ).resolves.toBe('/tmp/fallback');
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

    const botQueue = {} as QueuePublisher<BotEvent>;
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
        schemaVersion: 1,
        provider: 'slack',
        type: 'message.post',
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

  it('uses each repo base branch when preparing mention job repos', async () => {
    const registry = createRegistryMock();
    const loadJobRecordMock = registry.loadJobRecord;
    const updateJobRecordMock = registry.updateJobRecord;
    const runAgentMock = vi.mocked(AGENT_DESCRIPTORS.codex.adapter.run);
    const loadRepoAllowlistFromCatalogMock = vi.mocked(loadRepoAllowlistFromCatalog);
    const ensureCloneMock = vi.mocked(ensureClone);
    const mkdirMock = vi.mocked(mkdir);
    const writeFileMock = vi.mocked(writeFile);
    const appendFileMock = vi.mocked(appendFile);

    loadRepoAllowlistFromCatalogMock.mockResolvedValueOnce({
      'repo-1': {
        sshUrl: 'git@example.com:org/repo-1.git',
        projectId: 1,
        baseBranch: 'experimental',
      },
      'repo-2': {
        sshUrl: 'git@example.com:org/repo-2.git',
        projectId: 2,
        baseBranch: 'develop',
      },
    });

    const job = {
      jobId: 'job-mention-branches',
      type: 'MENTION' as const,
      repoKeys: ['repo-1', 'repo-2'],
      gitRef: 'main',
      requestText: 'Hello',
      channel: { provider: 'slack', channelId: 'C1', userId: 'U1', threadId: '123.456' },
    };

    loadJobRecordMock.mockResolvedValue({ job } as unknown as JobRecord);
    updateJobRecordMock.mockResolvedValue({} as JobRecord);
    runAgentMock.mockResolvedValue({
      threadId: 'thread-mention-branches',
      finalResponse: 'Hello there!',
    });
    mkdirMock.mockResolvedValue(undefined);
    writeFileMock.mockResolvedValue(undefined);
    appendFileMock.mockResolvedValue(undefined);

    const botQueue = {} as QueuePublisher<BotEvent>;
    await runJob(new BullMqBotEventSink(botQueue), job, registry);

    expect(ensureCloneMock).toHaveBeenNthCalledWith(
      1,
      'repo-1',
      expect.objectContaining({ baseBranch: 'experimental' }),
      '/tmp/sniptail/repo-cache/repo-1.git',
      '/tmp/sniptail/job-root/job-mention-branches/logs/runner.log',
      expect.any(Object),
      'experimental',
      expect.any(Array),
      expect.objectContaining({
        checkoutRef: true,
        forceLocalBranchUpdate: true,
      }),
    );
    expect(ensureCloneMock).toHaveBeenNthCalledWith(
      2,
      'repo-2',
      expect.objectContaining({ baseBranch: 'develop' }),
      '/tmp/sniptail/repo-cache/repo-2.git',
      '/tmp/sniptail/job-root/job-mention-branches/logs/runner.log',
      expect.any(Object),
      'develop',
      expect.any(Array),
      expect.objectContaining({
        checkoutRef: true,
        forceLocalBranchUpdate: true,
      }),
    );
  });

  it('runs an explore job and uploads report.md output', async () => {
    const registry = createRegistryMock();
    const loadJobRecordMock = registry.loadJobRecord;
    const updateJobRecordMock = registry.updateJobRecord;
    const runAgentMock = vi.mocked(AGENT_DESCRIPTORS.codex.adapter.run);
    const enqueueBotEventMock = vi.mocked(enqueueBotEvent);
    const readFileMock = vi.mocked(readFile);
    const mkdirMock = vi.mocked(mkdir);
    const writeFileMock = vi.mocked(writeFile);
    const appendFileMock = vi.mocked(appendFile);
    const buildSlackIdsMock = vi.mocked(buildSlackIds);
    const buildCompletionBlocksMock = vi.mocked(buildCompletionBlocks);

    const job = {
      jobId: 'job-explore',
      type: 'EXPLORE' as const,
      repoKeys: ['repo-1'],
      gitRef: 'main',
      requestText: 'Explore options',
      channel: { provider: 'slack', channelId: 'C1', userId: 'U1', threadId: '123.456' },
    };

    loadJobRecordMock.mockResolvedValue({ job } as unknown as JobRecord);
    updateJobRecordMock.mockResolvedValue({} as JobRecord);
    runAgentMock.mockResolvedValue({
      threadId: 'thread-explore-1',
      finalResponse: 'Explore result',
    });
    buildSlackIdsMock.mockReturnValue({
      commandPrefix: 'sniptail',
      commands: {
        repoAdd: '/sniptail-repo-add',
        repoRemove: '/sniptail-repo-remove',
        ask: '/sniptail-ask',
        explore: '/sniptail-explore',
        plan: '/sniptail-plan',
        implement: '/sniptail-implement',
        run: '/sniptail-run',
        bootstrap: '/sniptail-bootstrap',
        clearBefore: '/sniptail-clear-before',
        usage: '/sniptail-usage',
      },
      actions: {
        repoAddSubmit: 'repo-add-submit',
        repoRemoveSubmit: 'repo-remove-submit',
        askFromJob: 'ask-from-job',
        exploreFromJob: 'explore-from-job',
        planFromJob: 'plan-from-job',
        implementFromJob: 'implement-from-job',
        runFromJob: 'run-from-job',
        reviewFromJob: 'review-from-job',
        worktreeCommands: 'worktree-commands',
        clearJob: 'clear-job',
        askSubmit: 'ask-submit',
        exploreSubmit: 'explore-submit',
        planSubmit: 'plan-submit',
        implementSubmit: 'implement-submit',
        runSubmit: 'run-submit',
        bootstrapSubmit: 'bootstrap-submit',
        runActionSelect: 'run-action-select',
        answerQuestions: 'answer-questions',
        answerQuestionsSubmit: 'answer-questions-submit',
        approvalApprove: 'approval-approve',
        approvalDeny: 'approval-deny',
        approvalCancel: 'approval-cancel',
      },
    });
    buildCompletionBlocksMock.mockReturnValue([]);
    readFileMock.mockResolvedValue('# Explore report\n\nOption A\n');
    mkdirMock.mockResolvedValue(undefined);
    writeFileMock.mockResolvedValue(undefined);
    appendFileMock.mockResolvedValue(undefined);

    const botQueue = {} as QueuePublisher<BotEvent>;
    const result = await runJob(new BullMqBotEventSink(botQueue), job, registry);

    expect(result).toEqual({
      jobId: 'job-explore',
      status: 'ok',
      summary: '# Explore report\n\nOption A\n',
      reportPath: '/tmp/sniptail/job-root/job-explore/artifacts/report.md',
    });
    expect(readFileMock).toHaveBeenCalledWith(
      '/tmp/sniptail/job-root/job-explore/artifacts/report.md',
      'utf8',
    );
    expect(enqueueBotEventMock).toHaveBeenCalledWith(
      botQueue,
      expect.objectContaining({
        provider: 'slack',
        type: 'file.upload',
        payload: expect.objectContaining({
          channelId: 'C1',
          title: 'sniptail-job-explore-report.md',
          threadId: '123.456',
        }) as {
          channelId: string;
          title: string;
          threadId?: string;
          filePath?: string;
          fileContent?: string;
        },
      }),
    );
    expect(updateJobRecordMock).toHaveBeenCalledWith('job-explore', { status: 'running' });
    expect(updateJobRecordMock).toHaveBeenCalledWith(
      'job-explore',
      expect.objectContaining({
        status: 'ok',
        summary: '# Explore report\n\nOption A\n',
      }),
    );
  });

  it('creates resumed coding jobs on detached HEAD and appends lineage drift prompt warnings', async () => {
    const registry = createRegistryMock();
    const loadJobRecordMock = registry.loadJobRecord;
    const updateJobRecordMock = registry.updateJobRecord;
    const runAgentMock = vi.mocked(AGENT_DESCRIPTORS.codex.adapter.run);
    const readFileMock = vi.mocked(readFile);
    const addWorktreeMock = vi.mocked(addWorktree);
    const resolveGitRefMock = vi.mocked(resolveGitRef);
    const mkdirMock = vi.mocked(mkdir);
    const writeFileMock = vi.mocked(writeFile);
    const appendFileMock = vi.mocked(appendFile);
    const buildSlackIdsMock = vi.mocked(buildSlackIds);
    const buildCompletionBlocksMock = vi.mocked(buildCompletionBlocks);

    const job = {
      jobId: 'job-explore-resumed',
      type: 'EXPLORE' as const,
      repoKeys: ['repo-1'],
      gitRef: 'main',
      requestText: 'Explore options',
      resumeFromJobId: 'job-1',
      channel: { provider: 'slack', channelId: 'C1', userId: 'U1', threadId: '123.456' },
    };

    loadJobRecordMock.mockResolvedValue({
      job: { jobId: 'job-1' },
      originBranchByRepo: {
        'repo-1': 'sniptail/job-root',
      },
      lineageTipShaByRepo: {
        'repo-1': 'oldsha',
      },
    } as JobRecord);
    updateJobRecordMock.mockResolvedValue({} as JobRecord);
    runAgentMock.mockResolvedValue({
      threadId: 'thread-explore-resumed',
      finalResponse: 'Explore result',
    });
    resolveGitRefMock.mockResolvedValue('newsha');
    readFileMock.mockResolvedValue('# Explore report\n\nOption B\n');
    buildSlackIdsMock.mockReturnValue({
      commandPrefix: 'sniptail',
      commands: {
        repoAdd: '/sniptail-repo-add',
        repoRemove: '/sniptail-repo-remove',
        ask: '/sniptail-ask',
        explore: '/sniptail-explore',
        plan: '/sniptail-plan',
        implement: '/sniptail-implement',
        run: '/sniptail-run',
        bootstrap: '/sniptail-bootstrap',
        clearBefore: '/sniptail-clear-before',
        usage: '/sniptail-usage',
      },
      actions: {
        repoAddSubmit: 'repo-add-submit',
        repoRemoveSubmit: 'repo-remove-submit',
        askFromJob: 'ask-from-job',
        exploreFromJob: 'explore-from-job',
        planFromJob: 'plan-from-job',
        implementFromJob: 'implement-from-job',
        runFromJob: 'run-from-job',
        reviewFromJob: 'review-from-job',
        worktreeCommands: 'worktree-commands',
        clearJob: 'clear-job',
        askSubmit: 'ask-submit',
        exploreSubmit: 'explore-submit',
        planSubmit: 'plan-submit',
        implementSubmit: 'implement-submit',
        runSubmit: 'run-submit',
        bootstrapSubmit: 'bootstrap-submit',
        runActionSelect: 'run-action-select',
        answerQuestions: 'answer-questions',
        answerQuestionsSubmit: 'answer-questions-submit',
        approvalApprove: 'approval-approve',
        approvalDeny: 'approval-deny',
        approvalCancel: 'approval-cancel',
      },
    });
    buildCompletionBlocksMock.mockReturnValue([]);
    mkdirMock.mockResolvedValue(undefined);
    writeFileMock.mockResolvedValue(undefined);
    appendFileMock.mockResolvedValue(undefined);

    const botQueue = {} as QueuePublisher<BotEvent>;
    const result = await runJob(new BullMqBotEventSink(botQueue), job, registry);

    expect(result.status).toBe('ok');
    expect(addWorktreeMock).toHaveBeenCalledWith(
      expect.objectContaining({
        clonePath: '/tmp/sniptail/repo-cache/repo-1.git',
        worktreePath: '/tmp/sniptail/job-root/job-explore-resumed/repos/repo-1',
        baseRef: 'newsha',
      }),
    );
    expect(addWorktreeMock.mock.calls[0]?.[0]).not.toHaveProperty('branch');
    expect(updateJobRecordMock).toHaveBeenCalledWith(
      'job-explore-resumed',
      expect.objectContaining({
        originBranchByRepo: { 'repo-1': 'sniptail/job-root' },
        lineageBaseShaByRepo: { 'repo-1': 'newsha' },
        lineageTipShaByRepo: { 'repo-1': 'newsha' },
        lineageWarningByRepo: {
          'repo-1': 'Lineage branch sniptail/job-root moved from oldsha to newsha.',
        },
      }),
    );
    expect(runAgentMock).toHaveBeenCalledWith(
      job,
      '/tmp/sniptail/job-root/job-explore-resumed',
      expect.any(Object),
      expect.objectContaining({
        promptOverride: 'prompt with lineage warning',
      }),
    );
  });

  it('reuses an existing review request for resumed implement jobs', async () => {
    const registry = createRegistryMock();
    const loadJobRecordMock = registry.loadJobRecord;
    const updateJobRecordMock = registry.updateJobRecord;
    const runAgentMock = vi.mocked(AGENT_DESCRIPTORS.codex.adapter.run);
    const readFileMock = vi.mocked(readFile);
    const commitAndPushMock = vi.mocked(commitAndPushLineage);
    const createRepoReviewRequestMock = vi.mocked(createRepoReviewRequest);
    const mkdirMock = vi.mocked(mkdir);
    const writeFileMock = vi.mocked(writeFile);
    const appendFileMock = vi.mocked(appendFile);
    const buildSlackIdsMock = vi.mocked(buildSlackIds);
    const buildCompletionBlocksMock = vi.mocked(buildCompletionBlocks);

    const job = {
      jobId: 'job-implement-resumed',
      type: 'IMPLEMENT' as const,
      repoKeys: ['repo-1'],
      gitRef: 'main',
      requestText: 'Implement feature',
      resumeFromJobId: 'job-1',
      channel: { provider: 'slack', channelId: 'C1', userId: 'U1', threadId: '123.456' },
    };

    loadJobRecordMock.mockResolvedValue({
      job: { jobId: 'job-1' },
      originBranchByRepo: {
        'repo-1': 'sniptail/job-root',
      },
      lineageTipShaByRepo: {
        'repo-1': 'basesha',
      },
    } as JobRecord);
    updateJobRecordMock.mockResolvedValue({} as JobRecord);
    runAgentMock
      .mockResolvedValueOnce({
        threadId: 'thread-implement-resumed',
        finalResponse: 'Implementation done',
      })
      .mockResolvedValueOnce({
        threadId: 'thread-implement-artifacts',
        finalResponse: 'Artifacts done',
      });
    readFileMock.mockResolvedValueOnce('# Summary\n\nImplemented feature\n').mockResolvedValueOnce(
      JSON.stringify({
        mrTitle: 'Updated MR',
        commitTitle: 'feat: implement feature',
        commitBody: 'implemented feature',
      }),
    );
    commitAndPushMock.mockResolvedValue({
      committed: true,
      rebased: false,
      targetBranch: 'sniptail/job-root',
      commitSha: 'commitsha',
      pushedSha: 'pushedsha',
    });
    createRepoReviewRequestMock.mockResolvedValue({
      url: 'https://example.com/review/99',
      iid: 99,
      reused: true,
    });
    buildSlackIdsMock.mockReturnValue({
      commandPrefix: 'sniptail',
      commands: {
        repoAdd: '/sniptail-repo-add',
        repoRemove: '/sniptail-repo-remove',
        ask: '/sniptail-ask',
        explore: '/sniptail-explore',
        plan: '/sniptail-plan',
        implement: '/sniptail-implement',
        run: '/sniptail-run',
        bootstrap: '/sniptail-bootstrap',
        clearBefore: '/sniptail-clear-before',
        usage: '/sniptail-usage',
      },
      actions: {
        repoAddSubmit: 'repo-add-submit',
        repoRemoveSubmit: 'repo-remove-submit',
        askFromJob: 'ask-from-job',
        exploreFromJob: 'explore-from-job',
        planFromJob: 'plan-from-job',
        implementFromJob: 'implement-from-job',
        runFromJob: 'run-from-job',
        reviewFromJob: 'review-from-job',
        worktreeCommands: 'worktree-commands',
        clearJob: 'clear-job',
        askSubmit: 'ask-submit',
        exploreSubmit: 'explore-submit',
        planSubmit: 'plan-submit',
        implementSubmit: 'implement-submit',
        runSubmit: 'run-submit',
        bootstrapSubmit: 'bootstrap-submit',
        runActionSelect: 'run-action-select',
        answerQuestions: 'answer-questions',
        answerQuestionsSubmit: 'answer-questions-submit',
        approvalApprove: 'approval-approve',
        approvalDeny: 'approval-deny',
        approvalCancel: 'approval-cancel',
      },
    });
    buildCompletionBlocksMock.mockReturnValue([]);
    mkdirMock.mockResolvedValue(undefined);
    writeFileMock.mockResolvedValue(undefined);
    appendFileMock.mockResolvedValue(undefined);

    const botQueue = {} as QueuePublisher<BotEvent>;
    const result = await runJob(new BullMqBotEventSink(botQueue), job, registry);

    expect(result.status).toBe('ok');
    expect(result.mergeRequests).toEqual([
      { repoKey: 'repo-1', url: 'https://example.com/review/99', iid: 99 },
    ]);
    expect(commitAndPushMock).toHaveBeenCalledWith(
      expect.objectContaining({
        targetBranch: 'sniptail/job-root',
        expectedRemoteSha: 'abc123',
      }),
    );
    const reviewRequestCall = createRepoReviewRequestMock.mock.calls[0]?.[0] as
      | { input: { head: string; base: string } }
      | undefined;
    expect(reviewRequestCall).toBeDefined();
    if (!reviewRequestCall) {
      throw new Error('Expected createRepoReviewRequest to be called.');
    }
    expect(reviewRequestCall.input.head).toBe('sniptail/job-root');
    expect(reviewRequestCall.input.base).toBe('main');
    expect(getLatestSlackMessagePostText()).toContain('https://example.com/review/99');
  });

  it('runs a RUN job via repo contract and skips agent execution', async () => {
    const registry = createRegistryMock();
    const loadJobRecordMock = registry.loadJobRecord;
    const updateJobRecordMock = registry.updateJobRecord;
    const runAgentMock = vi.mocked(AGENT_DESCRIPTORS.codex.adapter.run);
    const runNamedRunContractDetailedMock = vi.mocked(runNamedRunContractDetailed);
    const runChecksMock = vi.mocked(runChecks);
    const commitAndPushMock = vi.mocked(commitAndPushLineage);
    const buildSlackIdsMock = vi.mocked(buildSlackIds);
    const buildCompletionBlocksMock = vi.mocked(buildCompletionBlocks);
    const enqueueBotEventMock = vi.mocked(enqueueBotEvent);
    const mkdirMock = vi.mocked(mkdir);
    const writeFileMock = vi.mocked(writeFile);
    const appendFileMock = vi.mocked(appendFile);

    const job = {
      jobId: 'job-run-contract',
      type: 'RUN' as const,
      repoKeys: ['repo-1'],
      gitRef: 'main',
      requestText: 'Run refresh-docs',
      run: { actionId: 'refresh-docs' },
      channel: { provider: 'slack', channelId: 'C1', userId: 'U1', threadId: '123.456' },
    };

    loadJobRecordMock.mockResolvedValue({ job } as unknown as JobRecord);
    updateJobRecordMock.mockResolvedValue({} as JobRecord);
    runNamedRunContractDetailedMock.mockResolvedValue({
      executed: true,
      contractPath:
        '/tmp/sniptail/job-root/job-run-contract/repos/repo-1/.sniptail/run/refresh-docs',
      result: {
        cmd: '/tmp/sniptail/job-root/job-run-contract/repos/repo-1/.sniptail/run/refresh-docs',
        args: [],
        cwd: '/tmp/sniptail/job-root/job-run-contract/repos/repo-1',
        durationMs: 27,
        exitCode: 0,
        signal: null,
        stdout: 'docs refreshed\n',
        stderr: '',
        timedOut: false,
        aborted: false,
      },
    });
    runChecksMock.mockResolvedValue(undefined);
    commitAndPushMock.mockResolvedValue({
      committed: false,
      rebased: false,
      targetBranch: 'sniptail/job-run-contract',
    });
    buildSlackIdsMock.mockReturnValue({
      commandPrefix: 'sniptail',
      commands: {
        repoAdd: '/sniptail-repo-add',
        repoRemove: '/sniptail-repo-remove',
        ask: '/sniptail-ask',
        explore: '/sniptail-explore',
        plan: '/sniptail-plan',
        implement: '/sniptail-implement',
        run: '/sniptail-run',
        bootstrap: '/sniptail-bootstrap',
        clearBefore: '/sniptail-clear-before',
        usage: '/sniptail-usage',
      },
      actions: {
        repoAddSubmit: 'repo-add-submit',
        repoRemoveSubmit: 'repo-remove-submit',
        askFromJob: 'ask-from-job',
        exploreFromJob: 'explore-from-job',
        planFromJob: 'plan-from-job',
        implementFromJob: 'implement-from-job',
        runFromJob: 'run-from-job',
        reviewFromJob: 'review-from-job',
        worktreeCommands: 'worktree-commands',
        clearJob: 'clear-job',
        askSubmit: 'ask-submit',
        exploreSubmit: 'explore-submit',
        planSubmit: 'plan-submit',
        implementSubmit: 'implement-submit',
        runSubmit: 'run-submit',
        bootstrapSubmit: 'bootstrap-submit',
        runActionSelect: 'run-action-select',
        answerQuestions: 'answer-questions',
        answerQuestionsSubmit: 'answer-questions-submit',
        approvalApprove: 'approval-approve',
        approvalDeny: 'approval-deny',
        approvalCancel: 'approval-cancel',
      },
    });
    buildCompletionBlocksMock.mockReturnValue([]);
    mkdirMock.mockResolvedValue(undefined);
    writeFileMock.mockResolvedValue(undefined);
    appendFileMock.mockResolvedValue(undefined);

    const botQueue = {} as QueuePublisher<BotEvent>;
    const result = await runJob(new BullMqBotEventSink(botQueue), job, registry);

    expect(result.jobId).toBe('job-run-contract');
    expect(result.status).toBe('ok');
    expect(result.summary).toContain('# Run Job job-run-contract');
    expect(result.reportPath).toBe('/tmp/sniptail/job-root/job-run-contract/artifacts/report.md');
    expect(runAgentMock).not.toHaveBeenCalled();
    expect(runNamedRunContractDetailedMock).toHaveBeenCalledWith(
      '/tmp/sniptail/job-root/job-run-contract/repos/repo-1',
      'refresh-docs',
      expect.objectContaining({
        SNIPTAIL_RUN_PARAMS_JSON: '{}',
      }),
      '/tmp/sniptail/job-root/job-run-contract/logs/runner.log',
      [],
      expect.objectContaining({
        timeoutMs: 600_000,
        allowFailure: false,
      }),
    );
    expect(writeFileMock).toHaveBeenCalledWith(
      '/tmp/sniptail/job-root/job-run-contract/artifacts/report.md',
      expect.stringContaining('## Output Snippets'),
      'utf8',
    );
    expect(enqueueBotEventMock).toHaveBeenCalled();
    expect(getLatestSlackMessagePostText()).toContain(
      'All set! Run job job-run-contract completed.',
    );
    expect(getLatestSlackMessagePostText()).toContain('Action: refresh-docs');
    expect(getLatestSlackMessagePostText()).toContain('Inputs: none');
    expect(getLatestSlackMessagePostText()).toContain('Execution:');
    expect(getLatestSlackMessagePostText()).not.toContain('Git output:');
    expect(
      getWriteFileContentForPath('/tmp/sniptail/job-root/job-run-contract/artifacts/report.md'),
    ).not.toContain('## Git Output');
    expect(runChecksMock).not.toHaveBeenCalled();
    expect(commitAndPushMock).not.toHaveBeenCalled();
  });

  it('runs RUN jobs with git_mode=implement through checks and commit flow', async () => {
    const registry = createRegistryMock();
    const loadJobRecordMock = registry.loadJobRecord;
    const updateJobRecordMock = registry.updateJobRecord;
    const runAgentMock = vi.mocked(AGENT_DESCRIPTORS.codex.adapter.run);
    const runNamedRunContractDetailedMock = vi.mocked(runNamedRunContractDetailed);
    const runChecksMock = vi.mocked(runChecks);
    const commitAndPushMock = vi.mocked(commitAndPushLineage);
    const runCommandMock = vi.mocked(runCommand);
    const buildSlackIdsMock = vi.mocked(buildSlackIds);
    const buildCompletionBlocksMock = vi.mocked(buildCompletionBlocks);
    const enqueueBotEventMock = vi.mocked(enqueueBotEvent);
    const mkdirMock = vi.mocked(mkdir);
    const writeFileMock = vi.mocked(writeFile);
    const appendFileMock = vi.mocked(appendFile);

    const job = {
      jobId: 'job-run-implement',
      type: 'RUN' as const,
      repoKeys: ['repo-1'],
      gitRef: 'main',
      requestText: 'Run refresh-with-mr',
      run: { actionId: 'refresh-with-mr' },
      channel: { provider: 'slack', channelId: 'C1', userId: 'U1', threadId: '123.456' },
    };

    loadJobRecordMock.mockResolvedValue({ job } as unknown as JobRecord);
    updateJobRecordMock.mockResolvedValue({} as JobRecord);
    runNamedRunContractDetailedMock.mockResolvedValue({ executed: false });
    runChecksMock.mockResolvedValue(undefined);
    commitAndPushMock.mockResolvedValue({
      committed: false,
      rebased: false,
      targetBranch: 'sniptail/job-run-implement',
    });
    runCommandMock.mockResolvedValue({
      cmd: 'pnpm',
      args: ['docs:refresh'],
      cwd: '/tmp/sniptail/job-root/job-run-implement/repos/repo-1',
      durationMs: 1,
      exitCode: 0,
      signal: null,
      stdout: '',
      stderr: '',
      timedOut: false,
      aborted: false,
    });
    buildSlackIdsMock.mockReturnValue({
      commandPrefix: 'sniptail',
      commands: {
        repoAdd: '/sniptail-repo-add',
        repoRemove: '/sniptail-repo-remove',
        ask: '/sniptail-ask',
        explore: '/sniptail-explore',
        plan: '/sniptail-plan',
        implement: '/sniptail-implement',
        run: '/sniptail-run',
        bootstrap: '/sniptail-bootstrap',
        clearBefore: '/sniptail-clear-before',
        usage: '/sniptail-usage',
      },
      actions: {
        repoAddSubmit: 'repo-add-submit',
        repoRemoveSubmit: 'repo-remove-submit',
        askFromJob: 'ask-from-job',
        exploreFromJob: 'explore-from-job',
        planFromJob: 'plan-from-job',
        implementFromJob: 'implement-from-job',
        runFromJob: 'run-from-job',
        reviewFromJob: 'review-from-job',
        worktreeCommands: 'worktree-commands',
        clearJob: 'clear-job',
        askSubmit: 'ask-submit',
        exploreSubmit: 'explore-submit',
        planSubmit: 'plan-submit',
        implementSubmit: 'implement-submit',
        runSubmit: 'run-submit',
        bootstrapSubmit: 'bootstrap-submit',
        runActionSelect: 'run-action-select',
        answerQuestions: 'answer-questions',
        answerQuestionsSubmit: 'answer-questions-submit',
        approvalApprove: 'approval-approve',
        approvalDeny: 'approval-deny',
        approvalCancel: 'approval-cancel',
      },
    });
    buildCompletionBlocksMock.mockReturnValue([]);
    mkdirMock.mockResolvedValue(undefined);
    writeFileMock.mockResolvedValue(undefined);
    appendFileMock.mockResolvedValue(undefined);

    const botQueue = {} as QueuePublisher<BotEvent>;
    const result = await runJob(new BullMqBotEventSink(botQueue), job, registry);

    expect(result.status).toBe('ok');
    expect(runAgentMock).not.toHaveBeenCalled();
    expect(runCommandMock).toHaveBeenCalledWith(
      'pnpm',
      ['docs:refresh'],
      expect.objectContaining({
        cwd: '/tmp/sniptail/job-root/job-run-implement/repos/repo-1',
      }),
    );
    expect(writeFileMock).toHaveBeenCalledWith(
      '/tmp/sniptail/job-root/job-run-implement/artifacts/report.md',
      expect.stringContaining('## Output Snippets'),
      'utf8',
    );
    expect(enqueueBotEventMock).toHaveBeenCalled();
    expect(getLatestSlackMessagePostText()).toContain(
      'All set! Run job job-run-implement completed.',
    );
    expect(getLatestSlackMessagePostText()).toContain('Action: refresh-with-mr');
    expect(getLatestSlackMessagePostText()).toContain('Inputs: none');
    expect(getLatestSlackMessagePostText()).toContain('Execution:');
    expect(getLatestSlackMessagePostText()).toContain('Git output:');
    expect(
      getWriteFileContentForPath('/tmp/sniptail/job-root/job-run-implement/artifacts/report.md'),
    ).toContain('## Git Output');
    expect(runChecksMock).toHaveBeenCalledWith(
      '/tmp/sniptail/job-root/job-run-implement/repos/repo-1',
      ['npm-lint'],
      expect.any(Object),
      '/tmp/sniptail/job-root/job-run-implement/logs/runner.log',
      [],
    );
    expect(commitAndPushMock).toHaveBeenCalled();
  });

  it('keeps RUN job status ok when allow_failure permits a non-zero exit', async () => {
    const registry = createRegistryMock();
    const loadJobRecordMock = registry.loadJobRecord;
    const updateJobRecordMock = registry.updateJobRecord;
    const runNamedRunContractDetailedMock = vi.mocked(runNamedRunContractDetailed);
    const runCommandMock = vi.mocked(runCommand);
    const writeFileMock = vi.mocked(writeFile);
    const mkdirMock = vi.mocked(mkdir);
    const appendFileMock = vi.mocked(appendFile);
    const buildSlackIdsMock = vi.mocked(buildSlackIds);
    const buildCompletionBlocksMock = vi.mocked(buildCompletionBlocks);

    const job = {
      jobId: 'job-run-allow-failure',
      type: 'RUN' as const,
      repoKeys: ['repo-1'],
      gitRef: 'main',
      requestText: 'Run refresh-allow-failure',
      run: { actionId: 'refresh-allow-failure' },
      channel: { provider: 'slack', channelId: 'C1', userId: 'U1', threadId: '123.456' },
    };

    loadJobRecordMock.mockResolvedValue({ job } as unknown as JobRecord);
    updateJobRecordMock.mockResolvedValue({} as JobRecord);
    runNamedRunContractDetailedMock.mockResolvedValue({ executed: false });
    runCommandMock.mockResolvedValue({
      cmd: 'pnpm',
      args: ['docs:refresh'],
      cwd: '/tmp/sniptail/job-root/job-run-allow-failure/repos/repo-1',
      durationMs: 3,
      exitCode: 1,
      signal: null,
      stdout: 'minor issue\n',
      stderr: '',
      timedOut: false,
      aborted: false,
    });
    buildSlackIdsMock.mockReturnValue({
      commandPrefix: 'sniptail',
      commands: {
        repoAdd: '/sniptail-repo-add',
        repoRemove: '/sniptail-repo-remove',
        ask: '/sniptail-ask',
        explore: '/sniptail-explore',
        plan: '/sniptail-plan',
        implement: '/sniptail-implement',
        run: '/sniptail-run',
        bootstrap: '/sniptail-bootstrap',
        clearBefore: '/sniptail-clear-before',
        usage: '/sniptail-usage',
      },
      actions: {
        repoAddSubmit: 'repo-add-submit',
        repoRemoveSubmit: 'repo-remove-submit',
        askFromJob: 'ask-from-job',
        exploreFromJob: 'explore-from-job',
        planFromJob: 'plan-from-job',
        implementFromJob: 'implement-from-job',
        runFromJob: 'run-from-job',
        reviewFromJob: 'review-from-job',
        worktreeCommands: 'worktree-commands',
        clearJob: 'clear-job',
        askSubmit: 'ask-submit',
        exploreSubmit: 'explore-submit',
        planSubmit: 'plan-submit',
        implementSubmit: 'implement-submit',
        runSubmit: 'run-submit',
        bootstrapSubmit: 'bootstrap-submit',
        runActionSelect: 'run-action-select',
        answerQuestions: 'answer-questions',
        answerQuestionsSubmit: 'answer-questions-submit',
        approvalApprove: 'approval-approve',
        approvalDeny: 'approval-deny',
        approvalCancel: 'approval-cancel',
      },
    });
    buildCompletionBlocksMock.mockReturnValue([]);
    mkdirMock.mockResolvedValue(undefined);
    writeFileMock.mockResolvedValue(undefined);
    appendFileMock.mockResolvedValue(undefined);

    const botQueue = {} as QueuePublisher<BotEvent>;
    const result = await runJob(new BullMqBotEventSink(botQueue), job, registry);

    expect(result.status).toBe('ok');
    expect(writeFileMock).toHaveBeenCalledWith(
      '/tmp/sniptail/job-root/job-run-allow-failure/artifacts/report.md',
      expect.stringContaining('[allow_failure]'),
      'utf8',
    );
  });

  it('includes command output snippet in RUN failure notifications', async () => {
    const registry = createRegistryMock();
    const loadJobRecordMock = registry.loadJobRecord;
    const updateJobRecordMock = registry.updateJobRecord;
    const runNamedRunContractDetailedMock = vi.mocked(runNamedRunContractDetailed);
    const enqueueBotEventMock = vi.mocked(enqueueBotEvent);
    const mkdirMock = vi.mocked(mkdir);
    const writeFileMock = vi.mocked(writeFile);
    const appendFileMock = vi.mocked(appendFile);

    const job = {
      jobId: 'job-run-failure-snippet',
      type: 'RUN' as const,
      repoKeys: ['repo-1'],
      gitRef: 'main',
      requestText: 'Run refresh-docs',
      run: { actionId: 'refresh-docs' },
      channel: { provider: 'slack', channelId: 'C1', userId: 'U1', threadId: '123.456' },
    };

    loadJobRecordMock.mockResolvedValue({ job } as unknown as JobRecord);
    updateJobRecordMock.mockResolvedValue({} as JobRecord);
    runNamedRunContractDetailedMock.mockRejectedValue(
      new CommandError('Command failed', {
        cmd: '/tmp/repo/.sniptail/run/refresh-docs',
        args: [],
        cwd: '/tmp/repo',
        durationMs: 8,
        exitCode: 1,
        signal: null,
        stdout: '',
        stderr: 'boom stderr\n',
        timedOut: false,
        aborted: false,
      }),
    );
    mkdirMock.mockResolvedValue(undefined);
    writeFileMock.mockResolvedValue(undefined);
    appendFileMock.mockResolvedValue(undefined);

    const botQueue = {} as QueuePublisher<BotEvent>;
    const result = await runJob(new BullMqBotEventSink(botQueue), job, registry);

    expect(result.status).toBe('failed');
    expect(enqueueBotEventMock).toHaveBeenCalled();
    expect(getLatestSlackMessagePostText()).toContain('Recent command stderr output');
    expect(updateJobRecordMock).toHaveBeenCalledWith(
      'job-run-failure-snippet',
      expect.objectContaining({
        status: 'failed',
      }),
    );
  });
});
