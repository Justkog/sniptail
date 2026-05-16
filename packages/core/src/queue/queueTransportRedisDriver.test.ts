import { beforeEach, describe, expect, it, vi } from 'vitest';

const hoisted = vi.hoisted(() => {
  const queueInstances: Array<{
    name: string;
    add: ReturnType<typeof vi.fn>;
    close: ReturnType<typeof vi.fn>;
  }> = [];
  const workerInstances: Array<{
    name: string;
    close: ReturnType<typeof vi.fn>;
    on: ReturnType<typeof vi.fn>;
  }> = [];

  class FakeQueue<T> {
    readonly name: string;
    readonly add = vi.fn((jobName: string, data: T) =>
      Promise.resolve({
        id: `${this.name}-${jobName}-1`,
        name: jobName,
        data,
      }),
    );
    readonly close = vi.fn(() => Promise.resolve(undefined));

    constructor(name: string) {
      this.name = name;
      queueInstances.push(this);
    }
  }

  class FakeWorker<T> {
    readonly name: string;
    readonly process: (job: { id?: string; name: string; data: T }) => Promise<void>;
    readonly close = vi.fn(() => Promise.resolve(undefined));
    readonly on = vi.fn();

    constructor(
      name: string,
      process: (job: { id?: string; name: string; data: T }) => Promise<void>,
    ) {
      this.name = name;
      this.process = process;
      workerInstances.push(this);
    }
  }

  return {
    queueInstances,
    workerInstances,
    FakeQueue,
    FakeWorker,
  };
});

vi.mock('bullmq', () => ({
  Queue: hoisted.FakeQueue,
  Worker: hoisted.FakeWorker,
}));

import { createRedisQueueTransportRuntime } from './queueTransportRedisDriver.js';

describe('queueTransportRedisDriver', () => {
  beforeEach(() => {
    hoisted.queueInstances.length = 0;
    hoisted.workerInstances.length = 0;
  });

  it('publishes targeted events to cached worker mailbox queues', async () => {
    const runtime = createRedisQueueTransportRuntime('redis://localhost:6379/0');

    const firstJob = await runtime.publishWorkerEventToMailbox('worker-a', {
      schemaVersion: 1,
      requestId: 'mail-1',
      type: 'jobs.clear',
      payload: { jobId: 'job-1', ttlMs: 60_000 },
    });
    const secondJob = await runtime.publishWorkerEventToMailbox('worker-a', {
      schemaVersion: 1,
      requestId: 'mail-2',
      type: 'jobs.clear',
      payload: { jobId: 'job-2', ttlMs: 60_000 },
    });

    expect(firstJob).toMatchObject({ name: 'jobs.clear' });
    expect(secondJob).toMatchObject({ name: 'jobs.clear' });
    const mailboxQueues = hoisted.queueInstances.filter((queue) =>
      queue.name.startsWith('sniptail-worker-mailbox:'),
    );
    expect(mailboxQueues).toHaveLength(1);
    expect(mailboxQueues[0]?.name).toBe('sniptail-worker-mailbox:worker-a');
    expect(mailboxQueues[0]?.add).toHaveBeenCalledTimes(2);

    await runtime.close();
  });

  it('creates mailbox consumers on worker-specific queue names', async () => {
    const runtime = createRedisQueueTransportRuntime('redis://localhost:6379/0');

    const consumer = runtime.consumeWorkerMailbox('worker-b', {
      concurrency: 2,
      handler: () => Promise.resolve(undefined),
    });

    expect(hoisted.workerInstances).toHaveLength(1);
    expect(hoisted.workerInstances[0]?.name).toBe('sniptail-worker-mailbox:worker-b');

    await consumer.close();
    await runtime.close();
  });

  it('rejects invalid worker ids for mailbox publish and consume', async () => {
    const runtime = createRedisQueueTransportRuntime('redis://localhost:6379/0');

    await expect(
      runtime.publishWorkerEventToMailbox('worker/a', {
        schemaVersion: 1,
        requestId: 'mail-invalid',
        type: 'jobs.clear',
        payload: { jobId: 'job-invalid', ttlMs: 60_000 },
      }),
    ).rejects.toThrow('Invalid worker.id');

    expect(() =>
      runtime.consumeWorkerMailbox('worker a', {
        concurrency: 1,
        handler: () => Promise.resolve(undefined),
      }),
    ).toThrow('Invalid worker.id');

    await runtime.close();
  });

  it('closes cached mailbox queues and mailbox consumers on shutdown', async () => {
    const runtime = createRedisQueueTransportRuntime('redis://localhost:6379/0');

    await runtime.publishWorkerEventToMailbox('worker-a', {
      schemaVersion: 1,
      requestId: 'mail-1',
      type: 'jobs.clear',
      payload: { jobId: 'job-1', ttlMs: 60_000 },
    });
    runtime.consumeWorkerMailbox('worker-a', {
      concurrency: 1,
      handler: () => Promise.resolve(undefined),
    });

    await runtime.close();

    const mailboxQueue = hoisted.queueInstances.find(
      (queue) => queue.name === 'sniptail-worker-mailbox:worker-a',
    );
    const mailboxWorker = hoisted.workerInstances.find(
      (worker) => worker.name === 'sniptail-worker-mailbox:worker-a',
    );
    expect(mailboxQueue?.close).toHaveBeenCalledTimes(1);
    expect(mailboxWorker?.close).toHaveBeenCalledTimes(1);
  });
});
