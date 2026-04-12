import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { BotConfig } from '@sniptail/core/config/config.js';
import type { NormalizedJobRequestInput } from './types.js';
import { submitNormalizedJobRequest } from './engine.js';

const saveJobQueuedMock = vi.hoisted(() => vi.fn());
const enqueueJobMock = vi.hoisted(() => vi.fn());

vi.mock('@sniptail/core/jobs/registry.js', () => ({
  saveJobQueued: saveJobQueuedMock,
}));

vi.mock('@sniptail/core/queue/queue.js', () => ({
  enqueueJob: enqueueJobMock,
}));

function makeConfig(): BotConfig {
  return {
    primaryAgent: 'codex',
    repoAllowlist: {},
  } as BotConfig;
}

function makeInput(
  overrides: Partial<NormalizedJobRequestInput> = {},
): NormalizedJobRequestInput {
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
    saveJobQueuedMock.mockResolvedValue(undefined);
    enqueueJobMock.mockResolvedValue(undefined);
  });

  it('returns invalid for non-MENTION jobs with empty repos', async () => {
    const authorize = vi.fn().mockResolvedValue(true);
    const result = await submitNormalizedJobRequest({
      config: makeConfig(),
      queue: {} as never,
      input: makeInput({ repoKeys: [] }),
      authorize,
    });

    expect(result).toEqual({
      status: 'invalid',
      message: 'Select at least one repository before submitting the request.',
    });
    expect(authorize).not.toHaveBeenCalled();
    expect(saveJobQueuedMock).not.toHaveBeenCalled();
    expect(enqueueJobMock).not.toHaveBeenCalled();
  });

  it('returns stopped when authorization denies the request', async () => {
    const authorize = vi.fn().mockResolvedValue(false);
    const result = await submitNormalizedJobRequest({
      config: makeConfig(),
      queue: {} as never,
      input: makeInput(),
      authorize,
    });

    expect(result.status).toBe('stopped');
    expect(authorize).toHaveBeenCalledTimes(1);
    expect(saveJobQueuedMock).not.toHaveBeenCalled();
    expect(enqueueJobMock).not.toHaveBeenCalled();
  });

  it('returns persist_failed when saving queued job fails', async () => {
    const expectedError = new Error('write failed');
    saveJobQueuedMock.mockRejectedValue(expectedError);
    const authorize = vi.fn().mockResolvedValue(true);

    const result = await submitNormalizedJobRequest({
      config: makeConfig(),
      queue: {} as never,
      input: makeInput(),
      authorize,
    });

    expect(result.status).toBe('persist_failed');
    expect(result.error).toBe(expectedError);
    expect(authorize).toHaveBeenCalledTimes(1);
    expect(saveJobQueuedMock).toHaveBeenCalledTimes(1);
    expect(enqueueJobMock).not.toHaveBeenCalled();
  });

  it('returns accepted and enqueues job when request is valid and authorized', async () => {
    const authorize = vi.fn().mockResolvedValue(true);
    const queue = {} as never;
    const result = await submitNormalizedJobRequest({
      config: makeConfig(),
      queue,
      input: makeInput(),
      authorize,
    });

    expect(result.status).toBe('accepted');
    expect(authorize).toHaveBeenCalledTimes(1);
    expect(saveJobQueuedMock).toHaveBeenCalledTimes(1);
    expect(enqueueJobMock).toHaveBeenCalledTimes(1);
    expect(enqueueJobMock).toHaveBeenCalledWith(queue, expect.objectContaining({ type: 'ASK' }));
  });

  it('allows empty repos for MENTION jobs', async () => {
    const authorize = vi.fn().mockResolvedValue(true);
    const result = await submitNormalizedJobRequest({
      config: makeConfig(),
      queue: {} as never,
      input: makeInput({
        type: 'MENTION',
        repoKeys: [],
        gitRef: undefined,
      }),
      authorize,
    });

    expect(result.status).toBe('accepted');
    expect(authorize).toHaveBeenCalledTimes(1);
    expect(saveJobQueuedMock).toHaveBeenCalledTimes(1);
    expect(enqueueJobMock).toHaveBeenCalledTimes(1);
  });
});
