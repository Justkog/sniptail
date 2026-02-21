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
      // eslint-disable-next-line @typescript-eslint/require-await
      handler: async (job) => {
        seenJobs.push(job.data.jobId);
      },
    });

    const workerEventsHandle = runtime.consumeWorkerEvents({
      concurrency: 1,
      // eslint-disable-next-line @typescript-eslint/require-await
      handler: async (job) => {
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

  it('preserves fifo ordering for a single channel', async () => {
    const seen: string[] = [];
    runtime.consumeJobs({
      concurrency: 1,
      // eslint-disable-next-line @typescript-eslint/require-await
      handler: async (job) => {
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
});
