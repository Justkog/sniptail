import { afterEach, describe, expect, it, vi } from 'vitest';
import type { JobRecord } from './registryTypes.js';
import { updateStoredJobRecord } from './registryRecordUpdate.js';

function buildRecord(): JobRecord {
  return {
    job: {
      jobId: 'job-1',
      type: 'ASK',
      repoKeys: ['repo-1'],
      gitRef: 'main',
      requestText: 'help',
      channel: {
        provider: 'slack',
        channelId: 'C1',
        threadId: 'T1',
      },
    },
    status: 'queued',
    createdAt: '2026-05-18T10:00:00.000Z',
    updatedAt: '2026-05-18T10:00:00.000Z',
  };
}

describe('updateStoredJobRecord', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('returns undefined when no record exists', async () => {
    const read = vi.fn(async () => undefined);
    const compareAndSwap = vi.fn(async () => true);

    await expect(updateStoredJobRecord(read, compareAndSwap, (record) => record)).resolves.toBe(
      undefined,
    );
    expect(read).toHaveBeenCalledTimes(1);
    expect(compareAndSwap).not.toHaveBeenCalled();
  });

  it('does not back off when first compare-and-swap succeeds', async () => {
    const timerSpy = vi.spyOn(globalThis, 'setTimeout');
    const read = vi.fn(async () => JSON.stringify(buildRecord()));
    const compareAndSwap = vi.fn(async () => true);

    await expect(
      updateStoredJobRecord(read, compareAndSwap, (record) => ({
        ...record,
        status: 'running',
      })),
    ).resolves.toMatchObject({ status: 'running' });
    expect(read).toHaveBeenCalledTimes(1);
    expect(compareAndSwap).toHaveBeenCalledTimes(1);
    expect(timerSpy).not.toHaveBeenCalled();
  });

  it('caps retries at five attempts and throws contention error', async () => {
    vi.useFakeTimers();
    const timerSpy = vi.spyOn(globalThis, 'setTimeout');
    const read = vi.fn(async () => JSON.stringify(buildRecord()));
    const compareAndSwap = vi.fn(async () => false);

    const result = updateStoredJobRecord(read, compareAndSwap, (record) => record);
    const rejection = expect(result).rejects.toThrowError(
      'Failed to update stored job record after 5 attempts due to contention',
    );
    await vi.runAllTimersAsync();
    await rejection;
    expect(read).toHaveBeenCalledTimes(5);
    expect(compareAndSwap).toHaveBeenCalledTimes(5);
    expect(timerSpy).toHaveBeenCalledTimes(4);
    expect(timerSpy).toHaveBeenNthCalledWith(1, expect.any(Function), 25);
  });
});
