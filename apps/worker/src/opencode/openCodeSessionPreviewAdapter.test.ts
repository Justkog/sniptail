import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { WorkerConfig } from '@sniptail/core/config/types.js';
import { openCodeAgentSessionPreviewAdapter } from './openCodeSessionPreviewAdapter.js';

const hoisted = vi.hoisted(() => ({
  createOpenCodeWorkerRuntime: vi.fn(),
  sessionMessages: vi.fn(),
  close: vi.fn(() => Promise.resolve()),
}));

vi.mock('./openCodeWorkerRuntime.js', () => ({
  createOpenCodeWorkerRuntime: hoisted.createOpenCodeWorkerRuntime,
}));

vi.mock('@sniptail/core/opencode/textParts.js', () => ({
  extractOpenCodeTextParts: (parts: unknown): string => {
    if (!Array.isArray(parts)) {
      return '';
    }

    return parts
      .filter(
        (part): part is { type: 'text'; text: string } =>
          Boolean(part) &&
          typeof part === 'object' &&
          (part as { type?: unknown }).type === 'text' &&
          typeof (part as { text?: unknown }).text === 'string',
      )
      .map((part) => part.text)
      .join('')
      .trim();
  },
}));

function buildConfig(): WorkerConfig {
  return {
    repoAllowlist: {},
    jobWorkRoot: '/tmp/jobs',
    queueDriver: 'redis',
    registryDriver: 'redis',
    registryRedisUrl: 'redis://localhost:6379/1',
    botName: 'Sniptail',
    workerId: 'worker-a',
    redisUrl: 'redis://localhost:6379/0',
    primaryAgent: 'codex',
    jobConcurrency: 2,
    workerEventConcurrency: 2,
    repoCacheRoot: '/tmp/repos',
    includeRawRequestInMr: false,
    copilot: {
      executionMode: 'local',
      idleRetries: 2,
      idleTimeoutMs: 300_000,
    },
    codex: {
      executionMode: 'local',
    },
    opencode: {
      executionMode: 'local',
      startupTimeoutMs: 10_000,
      dockerStreamLogs: false,
    },
    agent: {
      enabled: true,
      interactionTimeoutMs: 300_000,
      outputDebounceMs: 1_000,
      workspaces: {},
      profiles: {},
    },
  };
}

describe('openCodeSessionPreviewAdapter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hoisted.createOpenCodeWorkerRuntime.mockResolvedValue({
      client: {
        session: {
          messages: hoisted.sessionMessages,
        },
      },
      close: hoisted.close,
    });
  });

  it('populates createdAt from the latest assistant message info timestamp', async () => {
    hoisted.sessionMessages.mockResolvedValue({
      data: [
        {
          info: {
            role: 'assistant',
            time: {
              created: 1_716_368_400_000,
            },
          },
          parts: [{ type: 'text', text: 'Earlier response' }],
        },
        {
          info: {
            role: 'assistant',
            time: {
              created: 1_716_372_000_000,
            },
          },
          parts: [{ type: 'text', text: 'Latest response' }],
        },
      ],
    });

    const result = await openCodeAgentSessionPreviewAdapter.previewSession({
      config: buildConfig(),
      profile: {
        key: 'build',
        provider: 'opencode',
        profile: 'build',
      },
      providerSessionId: 'session-1',
    });

    expect(result.message).toEqual({
      role: 'agent',
      text: 'Latest response',
      createdAt: '2024-05-22T10:00:00.000Z',
    });
  });

  it('falls back to completed time when created time is absent', async () => {
    hoisted.sessionMessages.mockResolvedValue({
      data: [
        {
          info: {
            role: 'assistant',
            time: {
              completed: 1_716_372_600_000,
            },
          },
          parts: [{ type: 'text', text: 'Latest response' }],
        },
      ],
    });

    const result = await openCodeAgentSessionPreviewAdapter.previewSession({
      config: buildConfig(),
      profile: {
        key: 'build',
        provider: 'opencode',
      },
      providerSessionId: 'session-1',
    });

    expect(result.message).toEqual({
      role: 'agent',
      text: 'Latest response',
      createdAt: '2024-05-22T10:10:00.000Z',
    });
  });
});
