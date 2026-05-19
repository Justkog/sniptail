import { afterEach, describe, expect, it } from 'vitest';
import { createInprocQueueTransportRuntime } from './queueTransportInprocDriver.js';
import type { JobSpec } from '../types/job.js';

const TEST_CHANNEL = {
  provider: 'slack' as const,
  channelId: 'C1',
  userId: 'U1',
};

function createJob(jobId: string): JobSpec {
  return {
    jobId,
    type: 'ASK',
    repoKeys: ['repo'],
    gitRef: 'main',
    requestText: 'Test request',
    channel: TEST_CHANNEL,
  };
}

async function waitFor(condition: () => boolean, timeoutMs = 2_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > deadline) {
      throw new Error('Timed out waiting for condition');
    }
    await new Promise((resolve) => {
      setTimeout(resolve, 5);
    });
  }
}

describe('queueTransportInprocDriver', () => {
  let runtime = createInprocQueueTransportRuntime();

  afterEach(async () => {
    await runtime.close();
    runtime = createInprocQueueTransportRuntime();
  });

  it('dispatches job and worker-event channels in memory', async () => {
    const seenJobs: string[] = [];
    const seenWorkerEvents: string[] = [];

    const jobsHandle = runtime.consumeJobs({
      concurrency: 1,
      handler: (job) => {
        seenJobs.push(job.data.jobId);
      },
    });

    const workerEventsHandle = runtime.consumeWorkerEvents({
      concurrency: 1,
      handler: (job) => {
        seenWorkerEvents.push(job.data.type);
      },
    });

    await runtime.queues.jobs.add('ASK', createJob('job-1'), { jobId: 'job-1' });
    await runtime.queues.workerEvents.add('jobs.clear', {
      schemaVersion: 1,
      requestId: 'req-1',
      type: 'jobs.clear',
      payload: { jobId: 'job-1', ttlMs: 60_000 },
    });

    await waitFor(() => seenJobs.length === 1 && seenWorkerEvents.length === 1);
    expect(seenJobs).toEqual(['job-1']);
    expect(seenWorkerEvents).toEqual(['jobs.clear']);

    await jobsHandle.close();
    await workerEventsHandle.close();
  });

  it('routes targeted worker events only to the matching mailbox', async () => {
    const sharedWorkerEvents: string[] = [];
    const workerAMailbox: string[] = [];
    const workerBMailbox: string[] = [];

    const sharedHandle = runtime.consumeWorkerEvents({
      concurrency: 1,
      handler: (job) => {
        sharedWorkerEvents.push(job.data.requestId ?? job.data.type);
      },
    });
    const workerAHandle = runtime.consumeWorkerMailbox('worker-a', {
      concurrency: 1,
      handler: (job) => {
        workerAMailbox.push(job.data.requestId ?? job.data.type);
      },
    });
    const workerBHandle = runtime.consumeWorkerMailbox('worker-b', {
      concurrency: 1,
      handler: (job) => {
        workerBMailbox.push(job.data.requestId ?? job.data.type);
      },
    });

    await runtime.queues.workerEvents.add('jobs.clear', {
      schemaVersion: 1,
      requestId: 'shared-1',
      type: 'jobs.clear',
      payload: { jobId: 'job-1', ttlMs: 60_000 },
    });
    await runtime.publishWorkerEventToMailbox(
      'worker-a',
      {
        schemaVersion: 1,
        requestId: 'mail-a-1',
        type: 'jobs.clear',
        payload: { jobId: 'job-2', ttlMs: 60_000 },
      },
      { jobId: 'mailbox-job-a-1' },
    );
    await runtime.publishWorkerEventToMailbox(
      'worker-b',
      {
        schemaVersion: 1,
        requestId: 'mail-b-1',
        type: 'jobs.clear',
        payload: { jobId: 'job-3', ttlMs: 60_000 },
      },
      { jobId: 'mailbox-job-b-1' },
    );

    await waitFor(
      () =>
        sharedWorkerEvents.length === 1 &&
        workerAMailbox.length === 1 &&
        workerBMailbox.length === 1,
    );
    expect(sharedWorkerEvents).toEqual(['shared-1']);
    expect(workerAMailbox).toEqual(['mail-a-1']);
    expect(workerBMailbox).toEqual(['mail-b-1']);

    await sharedHandle.close();
    await workerAHandle.close();
    await workerBHandle.close();
  });

  it('routes targeted worker jobs only to the matching worker job mailbox', async () => {
    const sharedJobs: string[] = [];
    const workerAJobs: string[] = [];
    const workerBJobs: string[] = [];

    const sharedHandle = runtime.consumeJobs({
      concurrency: 1,
      handler: (job) => {
        sharedJobs.push(job.data.jobId);
      },
    });
    const workerAHandle = runtime.consumeWorkerJobMailbox('worker-a', {
      concurrency: 1,
      handler: (job) => {
        workerAJobs.push(job.data.jobId);
      },
    });
    const workerBHandle = runtime.consumeWorkerJobMailbox('worker-b', {
      concurrency: 1,
      handler: (job) => {
        workerBJobs.push(job.data.jobId);
      },
    });

    await runtime.queues.jobs.add('ASK', createJob('shared-1'), { jobId: 'shared-1' });
    await runtime.publishJobToWorkerMailbox('worker-a', createJob('job-a-1'), { jobId: 'job-a-1' });
    await runtime.publishJobToWorkerMailbox('worker-b', createJob('job-b-1'), { jobId: 'job-b-1' });

    await waitFor(
      () => sharedJobs.length === 1 && workerAJobs.length === 1 && workerBJobs.length === 1,
    );
    expect(sharedJobs).toEqual(['shared-1']);
    expect(workerAJobs).toEqual(['job-a-1']);
    expect(workerBJobs).toEqual(['job-b-1']);

    await sharedHandle.close();
    await workerAHandle.close();
    await workerBHandle.close();
  });

  it('pauses shared worker-event dispatch while mailbox jobs are pending', async () => {
    const sharedSeen: string[] = [];
    const mailboxSeen: string[] = [];
    let releaseMailbox!: () => void;
    const mailboxRunning = new Promise<void>((resolve) => {
      releaseMailbox = resolve;
    });

    const sharedHandle = runtime.consumeWorkerEvents({
      concurrency: 1,
      handler: (job) => {
        sharedSeen.push(job.data.requestId ?? job.data.type);
      },
    });
    const mailboxHandle = runtime.consumeWorkerMailbox('worker-a', {
      concurrency: 1,
      handler: async (job) => {
        mailboxSeen.push(job.data.requestId ?? job.data.type);
        await mailboxRunning;
      },
    });

    await sharedHandle.pause?.();
    await runtime.publishWorkerEventToMailbox('worker-a', {
      schemaVersion: 1,
      requestId: 'mail-1',
      type: 'jobs.clear',
      payload: { jobId: 'job-mail', ttlMs: 60_000 },
    });
    await runtime.queues.workerEvents.add('jobs.clear', {
      schemaVersion: 1,
      requestId: 'shared-1',
      type: 'jobs.clear',
      payload: { jobId: 'job-shared', ttlMs: 60_000 },
    });

    await waitFor(() => mailboxSeen.length === 1);
    expect(sharedSeen).toEqual([]);

    releaseMailbox();
    await waitFor(() => sharedSeen.length === 0);
    await sharedHandle.resume?.();
    await waitFor(() => sharedSeen.length === 1);
    expect(sharedSeen).toEqual(['shared-1']);

    await sharedHandle.close();
    await mailboxHandle.close();
  });

  it('preserves fifo ordering for a single channel', async () => {
    const seen: string[] = [];
    runtime.consumeJobs({
      concurrency: 1,
      handler: (job) => {
        seen.push(job.data.jobId);
      },
    });

    await runtime.queues.jobs.add('ASK', createJob('job-1'), { jobId: 'job-1' });
    await runtime.queues.jobs.add('ASK', createJob('job-2'), { jobId: 'job-2' });
    await runtime.queues.jobs.add('ASK', createJob('job-3'), { jobId: 'job-3' });

    await waitFor(() => seen.length === 3);
    expect(seen).toEqual(['job-1', 'job-2', 'job-3']);
  });

  it('respects channel concurrency', async () => {
    let running = 0;
    let maxRunning = 0;
    let completed = 0;

    runtime.consumeJobs({
      concurrency: 2,
      handler: async () => {
        running += 1;
        maxRunning = Math.max(maxRunning, running);
        await new Promise((resolve) => setTimeout(resolve, 20));
        running -= 1;
        completed += 1;
      },
    });

    await runtime.queues.jobs.add('ASK', createJob('job-1'), { jobId: 'job-1' });
    await runtime.queues.jobs.add('ASK', createJob('job-2'), { jobId: 'job-2' });
    await runtime.queues.jobs.add('ASK', createJob('job-3'), { jobId: 'job-3' });

    await waitFor(() => completed === 3);
    expect(maxRunning).toBe(2);
  });

  it('preserves fifo ordering for a single mailbox', async () => {
    const seen: string[] = [];
    runtime.consumeWorkerMailbox('worker-a', {
      concurrency: 1,
      handler: (job) => {
        seen.push(job.data.requestId ?? job.data.type);
      },
    });

    await runtime.publishWorkerEventToMailbox('worker-a', {
      schemaVersion: 1,
      requestId: 'mail-1',
      type: 'jobs.clear',
      payload: { jobId: 'job-1', ttlMs: 60_000 },
    });
    await runtime.publishWorkerEventToMailbox('worker-a', {
      schemaVersion: 1,
      requestId: 'mail-2',
      type: 'jobs.clear',
      payload: { jobId: 'job-2', ttlMs: 60_000 },
    });
    await runtime.publishWorkerEventToMailbox('worker-a', {
      schemaVersion: 1,
      requestId: 'mail-3',
      type: 'jobs.clear',
      payload: { jobId: 'job-3', ttlMs: 60_000 },
    });

    await waitFor(() => seen.length === 3);
    expect(seen).toEqual(['mail-1', 'mail-2', 'mail-3']);
  });

  it('preserves fifo ordering for a single worker job mailbox', async () => {
    const seen: string[] = [];
    runtime.consumeWorkerJobMailbox('worker-a', {
      concurrency: 1,
      handler: (job) => {
        seen.push(job.data.jobId);
      },
    });

    await runtime.publishJobToWorkerMailbox('worker-a', createJob('job-1'), { jobId: 'job-1' });
    await runtime.publishJobToWorkerMailbox('worker-a', createJob('job-2'), { jobId: 'job-2' });
    await runtime.publishJobToWorkerMailbox('worker-a', createJob('job-3'), { jobId: 'job-3' });

    await waitFor(() => seen.length === 3);
    expect(seen).toEqual(['job-1', 'job-2', 'job-3']);
  });

  it('rejects duplicate jobId while an item is pending/running', async () => {
    runtime.consumeJobs({
      concurrency: 1,
      handler: async () => {
        await new Promise((resolve) => setTimeout(resolve, 50));
      },
    });

    await runtime.queues.jobs.add('ASK', createJob('job-dup'), { jobId: 'job-dup' });

    await expect(
      runtime.queues.jobs.add('ASK', createJob('job-dup'), { jobId: 'job-dup' }),
    ).rejects.toThrow('Duplicate inproc job id "job-dup"');
  });

  it('tracks auto-generated job IDs in pendingJobIds to prevent collisions', async () => {
    runtime.consumeJobs({
      concurrency: 1,
      handler: async () => {
        await new Promise((resolve) => setTimeout(resolve, 50));
      },
    });

    // Enqueue without an explicit jobId — auto-generated id will be "sniptail-jobs-1"
    await runtime.queues.jobs.add('ASK', createJob('job-auto'));

    // An explicit jobId matching the auto-generated one should be rejected
    await expect(
      runtime.queues.jobs.add('ASK', createJob('job-auto'), { jobId: 'sniptail-jobs-1' }),
    ).rejects.toThrow('Duplicate inproc job id "sniptail-jobs-1"');
  });

  it('scopes duplicate mailbox job IDs to a single mailbox channel', async () => {
    runtime.consumeWorkerMailbox('worker-a', {
      concurrency: 1,
      handler: async () => {
        await new Promise((resolve) => setTimeout(resolve, 50));
      },
    });
    runtime.consumeWorkerMailbox('worker-b', {
      concurrency: 1,
      handler: async () => {
        await new Promise((resolve) => setTimeout(resolve, 50));
      },
    });

    await runtime.publishWorkerEventToMailbox(
      'worker-a',
      {
        schemaVersion: 1,
        requestId: 'mail-a-1',
        type: 'jobs.clear',
        payload: { jobId: 'job-a', ttlMs: 60_000 },
      },
      { jobId: 'shared-mailbox-job' },
    );

    await expect(
      runtime.publishWorkerEventToMailbox(
        'worker-a',
        {
          schemaVersion: 1,
          requestId: 'mail-a-2',
          type: 'jobs.clear',
          payload: { jobId: 'job-a-2', ttlMs: 60_000 },
        },
        { jobId: 'shared-mailbox-job' },
      ),
    ).rejects.toThrow('Duplicate inproc job id "shared-mailbox-job"');

    await expect(
      runtime.publishWorkerEventToMailbox(
        'worker-b',
        {
          schemaVersion: 1,
          requestId: 'mail-b-1',
          type: 'jobs.clear',
          payload: { jobId: 'job-b', ttlMs: 60_000 },
        },
        { jobId: 'shared-mailbox-job' },
      ),
    ).resolves.toMatchObject({ id: 'shared-mailbox-job' });
  });

  it('scopes duplicate worker job mailbox IDs to a single mailbox channel', async () => {
    runtime.consumeWorkerJobMailbox('worker-a', {
      concurrency: 1,
      handler: async () => {
        await new Promise((resolve) => setTimeout(resolve, 50));
      },
    });
    runtime.consumeWorkerJobMailbox('worker-b', {
      concurrency: 1,
      handler: async () => {
        await new Promise((resolve) => setTimeout(resolve, 50));
      },
    });

    await runtime.publishJobToWorkerMailbox('worker-a', createJob('job-a-1'), {
      jobId: 'shared-worker-job',
    });

    await expect(
      runtime.publishJobToWorkerMailbox('worker-a', createJob('job-a-2'), {
        jobId: 'shared-worker-job',
      }),
    ).rejects.toThrow('Duplicate inproc job id "shared-worker-job"');

    await expect(
      runtime.publishJobToWorkerMailbox('worker-b', createJob('job-b-1'), {
        jobId: 'shared-worker-job',
      }),
    ).resolves.toMatchObject({ id: 'shared-worker-job' });
  });

  it('delivers mailbox events published before a consumer subscribes', async () => {
    const seen: string[] = [];

    await runtime.publishWorkerEventToMailbox('worker-a', {
      schemaVersion: 1,
      requestId: 'mail-early',
      type: 'jobs.clear',
      payload: { jobId: 'job-early', ttlMs: 60_000 },
    });

    runtime.consumeWorkerMailbox('worker-a', {
      concurrency: 1,
      handler: (job) => {
        seen.push(job.data.requestId ?? job.data.type);
      },
    });

    await waitFor(() => seen.length === 1);
    expect(seen).toEqual(['mail-early']);
  });

  it('delivers worker jobs published before a consumer subscribes', async () => {
    const seen: string[] = [];

    await runtime.publishJobToWorkerMailbox('worker-a', createJob('job-early'));

    runtime.consumeWorkerJobMailbox('worker-a', {
      concurrency: 1,
      handler: (job) => {
        seen.push(job.data.jobId);
      },
    });

    await waitFor(() => seen.length === 1);
    expect(seen).toEqual(['job-early']);
  });

  it('observes mailbox availability and counts runnable mailbox jobs', async () => {
    const seen: string[] = [];
    const observer = runtime.observeWorkerMailbox('worker-a', {
      onJobAvailable: () => {
        seen.push('available');
      },
    });

    await runtime.publishWorkerEventToMailbox('worker-a', {
      schemaVersion: 1,
      requestId: 'mail-1',
      type: 'jobs.clear',
      payload: { jobId: 'job-1', ttlMs: 60_000 },
    });

    await waitFor(() => seen.length === 1);
    await expect(runtime.countWorkerMailboxJobs('worker-a')).resolves.toEqual({
      waiting: 1,
      prioritized: 0,
    });

    await observer.close();
  });

  it('observes worker job mailbox availability and counts runnable jobs', async () => {
    const seen: string[] = [];
    const observer = runtime.observeWorkerJobMailbox('worker-a', {
      onJobAvailable: () => {
        seen.push('available');
      },
    });

    await runtime.publishJobToWorkerMailbox('worker-a', createJob('job-1'));

    await waitFor(() => seen.length === 1);
    await expect(runtime.countWorkerJobMailboxJobs('worker-a')).resolves.toEqual({
      waiting: 1,
      prioritized: 0,
    });

    await observer.close();
  });

  it('rejects invalid worker ids for mailbox publish and consume', () => {
    expect(() =>
      runtime.publishWorkerEventToMailbox('worker/a', {
        schemaVersion: 1,
        requestId: 'bad-worker',
        type: 'jobs.clear',
        payload: { jobId: 'job-bad', ttlMs: 60_000 },
      }),
    ).toThrow('Invalid worker.id');

    expect(() =>
      runtime.consumeWorkerMailbox('worker a', {
        concurrency: 1,
        handler: () => undefined,
      }),
    ).toThrow('Invalid worker.id');

    expect(() => runtime.publishJobToWorkerMailbox('worker/a', createJob('job-bad'))).toThrow(
      'Invalid worker.id',
    );

    expect(() =>
      runtime.consumeWorkerJobMailbox('worker a', {
        concurrency: 1,
        handler: () => undefined,
      }),
    ).toThrow('Invalid worker.id');
  });
});
