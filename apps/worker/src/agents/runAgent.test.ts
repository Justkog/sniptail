import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { JobSpec } from '@sniptail/core/types/job.js';

const hoisted = vi.hoisted(() => ({
  run: vi.fn(),
  resolveAgentThreadId: vi.fn(),
  resolveMentionWorkingDirectory: vi.fn(),
  appendAgentEventLog: vi.fn(),
  addReaction: vi.fn(),
  loadJobRecord: vi.fn(),
}));

vi.mock('@sniptail/core/agents/agentRegistry.js', () => ({
  AGENT_DESCRIPTORS: {
    codex: {
      id: 'codex',
      adapter: { run: hoisted.run },
      resolveModelConfig: () => undefined,
      shouldIncludeRepoCache: () => false,
      buildRunOptions: () => ({}),
    },
    copilot: {
      id: 'copilot',
      adapter: { run: hoisted.run },
      resolveModelConfig: () => undefined,
      shouldIncludeRepoCache: () => false,
      buildRunOptions: () => ({}),
    },
    acp: {
      id: 'acp',
      adapter: { run: hoisted.run },
      resolveModelConfig: () => undefined,
      shouldIncludeRepoCache: () => false,
      buildRunOptions: () => ({}),
    },
  },
}));

vi.mock('../job/records.js', () => ({
  resolveAgentThreadId: hoisted.resolveAgentThreadId,
  resolveMentionWorkingDirectory: hoisted.resolveMentionWorkingDirectory,
}));

vi.mock('../job/artifacts.js', () => ({
  appendAgentEventLog: hoisted.appendAgentEventLog,
}));

vi.mock('@sniptail/core/logger.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

import { runAgentJob } from './runAgent.js';

function buildJob(): JobSpec {
  return {
    jobId: 'job-1',
    type: 'ASK',
    repoKeys: ['repo-1'],
    gitRef: 'main',
    requestText: 'Use current-turn files',
    channel: {
      provider: 'slack',
      channelId: 'C123',
      userId: 'U123',
    },
  };
}

describe('runAgentJob', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hoisted.run.mockResolvedValue({ finalResponse: 'done' });
    hoisted.resolveAgentThreadId.mockResolvedValue(undefined);
    hoisted.resolveMentionWorkingDirectory.mockResolvedValue('/tmp/mention-workdir');
    hoisted.loadJobRecord.mockResolvedValue(undefined);
  });

  it('passes only current-turn context files as native attachments', async () => {
    await runAgentJob({
      job: buildJob(),
      config: {
        primaryAgent: 'codex',
        botName: 'Sniptail',
        repoCacheRoot: '/tmp/repo-cache',
        jobWorkRoot: '/tmp/job-root',
      } as never,
      paths: {
        root: '/tmp/job-root/job-1',
        reposRoot: '/tmp/job-root/job-1/repos',
        artifactsRoot: '/tmp/job-root/job-1/artifacts',
        logsRoot: '/tmp/job-root/job-1/logs',
        logFile: '/tmp/job-root/job-1/logs/runner.log',
      },
      env: {},
      registry: {
        loadJobRecord: hoisted.loadJobRecord,
      } as never,
      notifier: {
        addReaction: hoisted.addReaction,
      } as never,
      currentTurnContextFiles: [
        {
          path: 'context/new-diagram.png',
          storedName: 'new-diagram.png',
          originalName: 'new diagram.png',
          mediaType: 'image/png',
          byteSize: 7,
        },
      ],
    });

    expect(hoisted.run).toHaveBeenCalledWith(
      expect.objectContaining({ jobId: 'job-1' }),
      '/tmp/job-root/job-1',
      {},
      expect.objectContaining({
        additionalDirectories: ['/tmp/job-root/job-1'],
        currentTurnAttachments: [
          {
            path: '/tmp/job-root/job-1/context/new-diagram.png',
            displayName: 'new diagram.png',
            mediaType: 'image/png',
          },
        ],
      }),
    );
  });

  it('keeps current-turn attachments reachable when mention jobs run from another directory', async () => {
    await runAgentJob({
      job: {
        ...buildJob(),
        type: 'MENTION',
      },
      config: {
        primaryAgent: 'codex',
        botName: 'Sniptail',
        repoCacheRoot: '/tmp/repo-cache',
        jobWorkRoot: '/tmp/job-root',
      } as never,
      paths: {
        root: '/tmp/job-root/job-mention',
        reposRoot: '/tmp/job-root/job-mention/repos',
        artifactsRoot: '/tmp/job-root/job-mention/artifacts',
        logsRoot: '/tmp/job-root/job-mention/logs',
        logFile: '/tmp/job-root/job-mention/logs/runner.log',
      },
      env: {},
      registry: {
        loadJobRecord: hoisted.loadJobRecord,
      } as never,
      notifier: {
        addReaction: hoisted.addReaction,
      } as never,
      currentTurnContextFiles: [
        {
          path: 'context/raccoon_kayaking.png',
          storedName: 'raccoon_kayaking.png',
          originalName: 'raccoon_kayaking.png',
          mediaType: 'image/png',
          byteSize: 7,
        },
      ],
    });

    expect(hoisted.run).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'MENTION' }),
      '/tmp/mention-workdir',
      {},
      expect.objectContaining({
        additionalDirectories: ['/tmp/job-root/job-mention'],
        currentTurnAttachments: [
          {
            path: '/tmp/job-root/job-mention/context/raccoon_kayaking.png',
            displayName: 'raccoon_kayaking.png',
            mediaType: 'image/png',
          },
        ],
      }),
    );
  });

  it('adds a provider-aware reaction on the latest request message before running the agent', async () => {
    hoisted.loadJobRecord.mockResolvedValue({
      job: {
        ...buildJob(),
        channel: {
          provider: 'slack',
          channelId: 'C999',
          threadId: 'thread-9',
          userId: 'U123',
          requestMessageId: '1712345678.000100',
        },
      },
    });

    await runAgentJob({
      job: buildJob(),
      config: {
        primaryAgent: 'codex',
        botName: 'Sniptail',
        repoCacheRoot: '/tmp/repo-cache',
        jobWorkRoot: '/tmp/job-root',
      } as never,
      paths: {
        root: '/tmp/job-root/job-1',
        reposRoot: '/tmp/job-root/job-1/repos',
        artifactsRoot: '/tmp/job-root/job-1/artifacts',
        logsRoot: '/tmp/job-root/job-1/logs',
        logFile: '/tmp/job-root/job-1/logs/runner.log',
      },
      env: {},
      registry: {
        loadJobRecord: hoisted.loadJobRecord,
      } as never,
      notifier: {
        addReaction: hoisted.addReaction,
      } as never,
    });

    expect(hoisted.addReaction).toHaveBeenCalledWith(
      {
        provider: 'slack',
        channelId: 'C999',
        threadId: 'thread-9',
      },
      'thought_balloon',
      { messageId: '1712345678.000100' },
    );
    expect(hoisted.addReaction.mock.invocationCallOrder[0]).toBeLessThan(
      hoisted.run.mock.invocationCallOrder[0],
    );
  });

  it('can skip the request reaction for followup runs', async () => {
    hoisted.loadJobRecord.mockResolvedValue({
      job: {
        ...buildJob(),
        channel: {
          provider: 'discord',
          channelId: 'D1',
          threadId: 'thread-1',
          userId: 'U123',
          requestMessageId: 'message-1',
        },
      },
    });

    await runAgentJob({
      job: buildJob(),
      config: {
        primaryAgent: 'codex',
        botName: 'Sniptail',
        repoCacheRoot: '/tmp/repo-cache',
        jobWorkRoot: '/tmp/job-root',
      } as never,
      paths: {
        root: '/tmp/job-root/job-1',
        reposRoot: '/tmp/job-root/job-1/repos',
        artifactsRoot: '/tmp/job-root/job-1/artifacts',
        logsRoot: '/tmp/job-root/job-1/logs',
        logFile: '/tmp/job-root/job-1/logs/runner.log',
      },
      env: {},
      registry: {
        loadJobRecord: hoisted.loadJobRecord,
      } as never,
      notifier: {
        addReaction: hoisted.addReaction,
      } as never,
      addRequestReaction: false,
    });

    expect(hoisted.addReaction).not.toHaveBeenCalled();
  });
});
