import { beforeEach, describe, expect, it, vi } from 'vitest';

const hoisted = vi.hoisted(() => {
  const queueInstances: Array<{
    name: string;
    add: ReturnType<typeof vi.fn>;
    getJobCounts: ReturnType<typeof vi.fn>;
    close: ReturnType<typeof vi.fn>;
  }> = [];
  const workerInstances: Array<{
    name: string;
    close: ReturnType<typeof vi.fn>;
    pause: ReturnType<typeof vi.fn>;
    resume: ReturnType<typeof vi.fn>;
    on: ReturnType<typeof vi.fn>;
  }> = [];
  const queueEventsInstances: Array<{
    name: string;
    close: ReturnType<typeof vi.fn>;
    on: ReturnType<typeof vi.fn>;
    off: ReturnType<typeof vi.fn>;
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
    readonly getJobCounts = vi.fn(() =>
      Promise.resolve({
        waiting: 0,
        prioritized: 0,
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
    readonly pause = vi.fn(() => Promise.resolve(undefined));
    readonly resume = vi.fn(() => Promise.resolve(undefined));
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

  class FakeQueueEvents {
    readonly name: string;
    readonly close = vi.fn(() => Promise.resolve(undefined));
    readonly on = vi.fn();
    readonly off = vi.fn();

    constructor(name: string) {
      this.name = name;
      queueEventsInstances.push(this);
    }
  }

  return {
    queueInstances,
    workerInstances,
    queueEventsInstances,
    FakeQueue,
    FakeWorker,
    FakeQueueEvents,
  };
});

vi.mock('bullmq', () => ({
  Queue: hoisted.FakeQueue,
  QueueEvents: hoisted.FakeQueueEvents,
  Worker: hoisted.FakeWorker,
}));

import { createRedisQueueTransportRuntime } from './queueTransportRedisDriver.js';

describe('queueTransportRedisDriver', () => {
  beforeEach(() => {
    hoisted.queueInstances.length = 0;
    hoisted.workerInstances.length = 0;
    hoisted.queueEventsInstances.length = 0;
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

  it('publishes targeted jobs to cached worker job mailbox queues', async () => {
    const runtime = createRedisQueueTransportRuntime('redis://localhost:6379/0');

    const firstJob = await runtime.publishJobToWorkerMailbox('worker-a', {
      jobId: 'job-1',
      type: 'ASK',
      repoKeys: ['repo'],
      gitRef: 'main',
      requestText: 'Test request',
      channel: { provider: 'slack', channelId: 'C1', userId: 'U1' },
    });
    const secondJob = await runtime.publishJobToWorkerMailbox('worker-a', {
      jobId: 'job-2',
      type: 'PLAN',
      repoKeys: ['repo'],
      gitRef: 'main',
      requestText: 'Plan request',
      channel: { provider: 'slack', channelId: 'C1', userId: 'U1' },
    });

    expect(firstJob).toMatchObject({ name: 'ASK' });
    expect(secondJob).toMatchObject({ name: 'PLAN' });
    const mailboxQueues = hoisted.queueInstances.filter((queue) =>
      queue.name.startsWith('sniptail-worker-jobs:'),
    );
    expect(mailboxQueues).toHaveLength(1);
    expect(mailboxQueues[0]?.name).toBe('sniptail-worker-jobs:worker-a');
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
    await consumer.pause?.();
    await consumer.resume?.();
    expect(hoisted.workerInstances[0]?.pause).toHaveBeenCalledWith(true);
    expect(hoisted.workerInstances[0]?.resume).toHaveBeenCalledTimes(1);

    await consumer.close();
    await runtime.close();
  });

  it('creates worker job mailbox consumers on worker-specific queue names', async () => {
    const runtime = createRedisQueueTransportRuntime('redis://localhost:6379/0');

    const consumer = runtime.consumeWorkerJobMailbox('worker-b', {
      concurrency: 2,
      handler: () => Promise.resolve(undefined),
    });

    expect(hoisted.workerInstances).toHaveLength(1);
    expect(hoisted.workerInstances[0]?.name).toBe('sniptail-worker-jobs:worker-b');
    await consumer.pause?.();
    await consumer.resume?.();
    expect(hoisted.workerInstances[0]?.pause).toHaveBeenCalledWith(true);
    expect(hoisted.workerInstances[0]?.resume).toHaveBeenCalledTimes(1);

    await consumer.close();
    await runtime.close();
  });

  it('observes mailbox waiting events and counts runnable jobs', async () => {
    const runtime = createRedisQueueTransportRuntime('redis://localhost:6379/0');
    const onJobAvailable = vi.fn();

    const observer = runtime.observeWorkerMailbox('worker-b', { onJobAvailable });

    expect(hoisted.queueEventsInstances).toHaveLength(1);
    expect(hoisted.queueEventsInstances[0]?.name).toBe('sniptail-worker-mailbox:worker-b');

    const waitingHandler = hoisted.queueEventsInstances[0]?.on.mock.calls.find(
      (call) => call[0] === 'waiting',
    )?.[1] as (() => void) | undefined;
    waitingHandler?.();
    await Promise.resolve();
    expect(onJobAvailable).toHaveBeenCalledTimes(1);

    const counts = await runtime.countWorkerMailboxJobs('worker-b');
    expect(counts).toEqual({ waiting: 0, prioritized: 0 });
    const mailboxQueue = hoisted.queueInstances.find(
      (queue) => queue.name === 'sniptail-worker-mailbox:worker-b',
    );
    expect(mailboxQueue?.getJobCounts).toHaveBeenCalledWith('waiting', 'prioritized');

    await observer.close();
    expect(hoisted.queueEventsInstances[0]?.off).toHaveBeenCalledWith('waiting', waitingHandler);
    await runtime.close();
  });

  it('observes worker job mailbox waiting events and counts runnable jobs', async () => {
    const runtime = createRedisQueueTransportRuntime('redis://localhost:6379/0');
    const onJobAvailable = vi.fn();

    const observer = runtime.observeWorkerJobMailbox('worker-b', { onJobAvailable });

    expect(hoisted.queueEventsInstances).toHaveLength(1);
    expect(hoisted.queueEventsInstances[0]?.name).toBe('sniptail-worker-jobs:worker-b');

    const waitingHandler = hoisted.queueEventsInstances[0]?.on.mock.calls.find(
      (call) => call[0] === 'waiting',
    )?.[1] as (() => void) | undefined;
    waitingHandler?.();
    await Promise.resolve();
    expect(onJobAvailable).toHaveBeenCalledTimes(1);

    const counts = await runtime.countWorkerJobMailboxJobs('worker-b');
    expect(counts).toEqual({ waiting: 0, prioritized: 0 });
    const mailboxQueue = hoisted.queueInstances.find(
      (queue) => queue.name === 'sniptail-worker-jobs:worker-b',
    );
    expect(mailboxQueue?.getJobCounts).toHaveBeenCalledWith('waiting', 'prioritized');

    await observer.close();
    expect(hoisted.queueEventsInstances[0]?.off).toHaveBeenCalledWith('waiting', waitingHandler);
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

    await expect(
      runtime.publishJobToWorkerMailbox('worker/a', {
        jobId: 'job-invalid',
        type: 'ASK',
        repoKeys: ['repo'],
        gitRef: 'main',
        requestText: 'Invalid worker',
        channel: { provider: 'slack', channelId: 'C1', userId: 'U1' },
      }),
    ).rejects.toThrow('Invalid worker.id');

    expect(() =>
      runtime.consumeWorkerJobMailbox('worker a', {
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
    runtime.observeWorkerMailbox('worker-a', {
      onJobAvailable: () => Promise.resolve(undefined),
    });
    await runtime.publishJobToWorkerMailbox('worker-a', {
      jobId: 'job-2',
      type: 'ASK',
      repoKeys: ['repo'],
      gitRef: 'main',
      requestText: 'Test request',
      channel: { provider: 'slack', channelId: 'C1', userId: 'U1' },
    });
    runtime.consumeWorkerJobMailbox('worker-a', {
      concurrency: 1,
      handler: () => Promise.resolve(undefined),
    });
    runtime.observeWorkerJobMailbox('worker-a', {
      onJobAvailable: () => Promise.resolve(undefined),
    });

    await runtime.close();

    const mailboxQueue = hoisted.queueInstances.find(
      (queue) => queue.name === 'sniptail-worker-mailbox:worker-a',
    );
    const mailboxWorker = hoisted.workerInstances.find(
      (worker) => worker.name === 'sniptail-worker-mailbox:worker-a',
    );
    const mailboxEvents = hoisted.queueEventsInstances.find(
      (events) => events.name === 'sniptail-worker-mailbox:worker-a',
    );
    const workerJobMailboxQueue = hoisted.queueInstances.find(
      (queue) => queue.name === 'sniptail-worker-jobs:worker-a',
    );
    const workerJobMailboxWorker = hoisted.workerInstances.find(
      (worker) => worker.name === 'sniptail-worker-jobs:worker-a',
    );
    const workerJobMailboxEvents = hoisted.queueEventsInstances.find(
      (events) => events.name === 'sniptail-worker-jobs:worker-a',
    );
    expect(mailboxQueue?.close).toHaveBeenCalledTimes(1);
    expect(mailboxWorker?.close).toHaveBeenCalledTimes(1);
    expect(mailboxEvents?.close).toHaveBeenCalledTimes(1);
    expect(workerJobMailboxQueue?.close).toHaveBeenCalledTimes(1);
    expect(workerJobMailboxWorker?.close).toHaveBeenCalledTimes(1);
    expect(workerJobMailboxEvents?.close).toHaveBeenCalledTimes(1);
  });
});
