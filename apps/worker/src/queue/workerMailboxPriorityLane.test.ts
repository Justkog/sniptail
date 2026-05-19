import { describe, expect, it, vi } from 'vitest';
import type { QueueConsumerHandle } from '@sniptail/core/queue/queueTransportTypes.js';
import { createWorkerMailboxPriorityLane } from './workerMailboxPriorityLane.js';

function createConsumerHandle(
  overrides: Partial<{
    close: () => Promise<void>;
    pause: () => Promise<void>;
    resume: () => Promise<void>;
  }> = {},
): QueueConsumerHandle {
  return {
    close: overrides.close ?? vi.fn(() => Promise.resolve(undefined)),
    pause: overrides.pause ?? vi.fn(() => Promise.resolve(undefined)),
    resume: overrides.resume ?? vi.fn(() => Promise.resolve(undefined)),
  };
}

describe('workerMailboxPriorityLane', () => {
  it('serializes shared and mailbox handlers through the same lane', async () => {
    let releaseShared!: () => void;
    const sharedRunning = new Promise<void>((resolve) => {
      releaseShared = resolve;
    });
    const mailboxStarted = vi.fn();
    const lane = createWorkerMailboxPriorityLane({
      getSharedConsumer: () => undefined,
      countMailboxJobs: vi.fn(() => Promise.resolve({ waiting: 0, prioritized: 0 })),
    });

    const sharedPromise = lane.runShared(async () => {
      await sharedRunning;
    });
    await Promise.resolve();
    const mailboxPromise = lane.runMailbox(() => {
      mailboxStarted();
    });
    await Promise.resolve();

    expect(mailboxStarted).not.toHaveBeenCalled();

    releaseShared();
    await Promise.all([sharedPromise, mailboxPromise]);

    expect(mailboxStarted).toHaveBeenCalledTimes(1);
  });

  it('pauses shared consumption when the shared consumer exposes pause', async () => {
    const pauseMock = vi.fn(() => Promise.resolve(undefined));
    const consumer = createConsumerHandle({ pause: pauseMock });
    const lane = createWorkerMailboxPriorityLane({
      getSharedConsumer: () => consumer,
      countMailboxJobs: vi.fn(() => Promise.resolve({ waiting: 0, prioritized: 0 })),
    });

    await lane.pauseShared();

    expect(pauseMock).toHaveBeenCalledTimes(1);
  });

  it('treats shared pause and resume as no-ops without a shared consumer', async () => {
    const countMailboxJobs = vi.fn(() => Promise.resolve({ waiting: 0, prioritized: 0 }));
    const lane = createWorkerMailboxPriorityLane({
      getSharedConsumer: () => undefined,
      countMailboxJobs,
    });

    await expect(lane.pauseShared()).resolves.toBeUndefined();
    await expect(lane.resumeSharedIfMailboxIdle()).resolves.toBeUndefined();

    expect(countMailboxJobs).not.toHaveBeenCalled();
  });

  it('resumes shared consumption only when the mailbox is idle', async () => {
    const resumeMock = vi.fn(() => Promise.resolve(undefined));
    const consumer = createConsumerHandle({ resume: resumeMock });
    const countMailboxJobs = vi
      .fn<() => Promise<{ waiting: number; prioritized: number }>>()
      .mockResolvedValueOnce({ waiting: 1, prioritized: 0 })
      .mockResolvedValueOnce({ waiting: 0, prioritized: 0 });
    const lane = createWorkerMailboxPriorityLane({
      getSharedConsumer: () => consumer,
      countMailboxJobs,
    });

    await lane.resumeSharedIfMailboxIdle();
    await lane.resumeSharedIfMailboxIdle();

    expect(resumeMock).toHaveBeenCalledTimes(1);
  });

  it('pauses shared consumption on startup when mailbox jobs are already pending', async () => {
    const pauseMock = vi.fn(() => Promise.resolve(undefined));
    const consumer = createConsumerHandle({ pause: pauseMock });
    const lane = createWorkerMailboxPriorityLane({
      getSharedConsumer: () => consumer,
      countMailboxJobs: vi.fn(() => Promise.resolve({ waiting: 0, prioritized: 2 })),
    });

    await lane.pauseSharedIfMailboxPendingOnStartup();

    expect(pauseMock).toHaveBeenCalledTimes(1);
  });

  it('propagates mailbox count failures to the caller', async () => {
    const lane = createWorkerMailboxPriorityLane({
      getSharedConsumer: () => createConsumerHandle(),
      countMailboxJobs: vi.fn(() => Promise.reject(new Error('count failed'))),
    });

    await expect(lane.resumeSharedIfMailboxIdle()).rejects.toThrow('count failed');
    await expect(lane.pauseSharedIfMailboxPendingOnStartup()).rejects.toThrow('count failed');
  });
});
