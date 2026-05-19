import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { BotConfig } from '@sniptail/core/config/config.js';
import type { NormalizedJobRequestInput } from './types.js';
import { submitNormalizedJobRequest } from './engine.js';

const saveAndEnqueueManagedJobMock = vi.hoisted(() => vi.fn());

vi.mock('./enqueueManagedJob.js', () => ({
  saveAndEnqueueManagedJob: saveAndEnqueueManagedJobMock,
}));

function makeConfig(): BotConfig {
  return {
    agentCommand: {},
    primaryAgent: 'codex',
    repoAllowlist: {},
  } as BotConfig;
}

function makeInput(overrides: Partial<NormalizedJobRequestInput> = {}): NormalizedJobRequestInput {
  return {
    type: 'ASK',
    repoKeys: ['repo-a'],
    gitRef: 'main',
    requestText: 'What changed?',
    channel: {
      provider: 'slack',
      channelId: 'C1',
      userId: 'U1',
      threadTs: '111.222',
    },
    ...overrides,
  };
}

describe('submitNormalizedJobRequest', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    saveAndEnqueueManagedJobMock.mockResolvedValue({
      status: 'accepted',
      target: 'shared',
    });
  });

  it('returns invalid for non-MENTION jobs with empty repos', async () => {
    const authorize = vi.fn().mockResolvedValue(true);
    const result = await submitNormalizedJobRequest({
      config: makeConfig(),
      queueRuntime: {
        queues: {
          jobs: { add: vi.fn() },
        },
        publishJobToWorkerMailbox: vi.fn(),
      } as never,
      input: makeInput({ repoKeys: [] }),
      authorize,
    });

    expect(result).toEqual({
      status: 'invalid',
      message: 'Select at least one repository before submitting the request.',
    });
    expect(authorize).not.toHaveBeenCalled();
    expect(saveAndEnqueueManagedJobMock).not.toHaveBeenCalled();
  });

  it('returns stopped when authorization denies the request', async () => {
    const authorize = vi.fn().mockResolvedValue(false);
    const result = await submitNormalizedJobRequest({
      config: makeConfig(),
      queueRuntime: {
        queues: {
          jobs: { add: vi.fn() },
        },
        publishJobToWorkerMailbox: vi.fn(),
      } as never,
      input: makeInput(),
      authorize,
    });

    expect(result.status).toBe('stopped');
    expect(authorize).toHaveBeenCalledTimes(1);
    expect(saveAndEnqueueManagedJobMock).not.toHaveBeenCalled();
  });

  it('returns persist_failed when managed-job persistence fails', async () => {
    const expectedError = new Error('write failed');
    saveAndEnqueueManagedJobMock.mockResolvedValue({
      status: 'persist_failed',
      error: expectedError,
    });
    const authorize = vi.fn().mockResolvedValue(true);

    const result = await submitNormalizedJobRequest({
      config: makeConfig(),
      queueRuntime: {
        queues: {
          jobs: { add: vi.fn() },
        },
        publishJobToWorkerMailbox: vi.fn(),
      } as never,
      input: makeInput(),
      authorize,
    });

    expect(result.status).toBe('persist_failed');
    expect(result.error).toBe(expectedError);
    expect(authorize).toHaveBeenCalledTimes(1);
    expect(saveAndEnqueueManagedJobMock).toHaveBeenCalledTimes(1);
  });

  it('returns accepted when request is valid and authorized', async () => {
    const authorize = vi.fn().mockResolvedValue(true);
    const queueRuntime = {
      queues: {
        jobs: { add: vi.fn() },
      },
      publishJobToWorkerMailbox: vi.fn(),
    } as never;
    const result = await submitNormalizedJobRequest({
      config: makeConfig(),
      queueRuntime,
      input: makeInput(),
      authorize,
    });

    expect(result.status).toBe('accepted');
    expect(authorize).toHaveBeenCalledTimes(1);
    expect(saveAndEnqueueManagedJobMock).toHaveBeenCalledTimes(1);
    expect(saveAndEnqueueManagedJobMock.mock.calls[0]?.[0]).toMatchObject({
      config: makeConfig(),
      queueRuntime,
      job: {
        type: 'ASK',
      },
    });
  });

  it('allows empty repos for MENTION jobs', async () => {
    const authorize = vi.fn().mockResolvedValue(true);
    const result = await submitNormalizedJobRequest({
      config: makeConfig(),
      queueRuntime: {
        queues: {
          jobs: { add: vi.fn() },
        },
        publishJobToWorkerMailbox: vi.fn(),
      } as never,
      input: makeInput({
        type: 'MENTION',
        repoKeys: [],
        gitRef: undefined,
      }),
      authorize,
    });

    expect(result.status).toBe('accepted');
    expect(authorize).toHaveBeenCalledTimes(1);
    expect(saveAndEnqueueManagedJobMock).toHaveBeenCalledTimes(1);
  });

  it('returns invalid when owner routing rejects a resumed job', async () => {
    const authorize = vi.fn().mockResolvedValue(true);
    saveAndEnqueueManagedJobMock.mockResolvedValue({
      status: 'invalid',
      message: 'Job ask-1 is waiting for owner worker worker-a to return.',
    });

    const result = await submitNormalizedJobRequest({
      config: makeConfig(),
      queueRuntime: {
        queues: {
          jobs: { add: vi.fn() },
        },
        publishJobToWorkerMailbox: vi.fn(),
      } as never,
      input: makeInput({ resumeFromJobId: 'ask-1' }),
      authorize,
    });

    expect(result).toEqual({
      status: 'invalid',
      message: 'Job ask-1 is waiting for owner worker worker-a to return.',
    });
  });
});
