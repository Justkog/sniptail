import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { BotConfig } from '@sniptail/core/config/config.js';
import type { JobSpec } from '@sniptail/core/types/job.js';
import { saveAndEnqueueManagedJob } from './enqueueManagedJob.js';

const saveJobQueuedMock = vi.hoisted(() => vi.fn());
const enqueueJobMock = vi.hoisted(() => vi.fn());
const enqueueWorkerMailboxJobMock = vi.hoisted(() => vi.fn());
const resolveManagedJobOwnerRouteMock = vi.hoisted(() => vi.fn());

vi.mock('@sniptail/core/jobs/registry.js', () => ({
  saveJobQueued: saveJobQueuedMock,
}));

vi.mock('@sniptail/core/queue/queue.js', () => ({
  enqueueJob: enqueueJobMock,
  enqueueWorkerMailboxJob: enqueueWorkerMailboxJobMock,
}));

vi.mock('./ownerRouting.js', () => ({
  resolveManagedJobOwnerRoute: resolveManagedJobOwnerRouteMock,
}));

function makeConfig(): BotConfig {
  return {
    agentCommand: {},
    primaryAgent: 'codex',
    repoAllowlist: {},
  } as BotConfig;
}

function makeJob(overrides: Partial<JobSpec> = {}): JobSpec {
  return {
    jobId: 'ask-1',
    type: 'ASK',
    repoKeys: ['repo-a'],
    primaryRepoKey: 'repo-a',
    gitRef: 'main',
    requestText: 'What changed?',
    agent: 'codex',
    channel: {
      provider: 'slack',
      channelId: 'C1',
      userId: 'U1',
      threadId: '111.222',
    },
    ...overrides,
  };
}

describe('saveAndEnqueueManagedJob', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    saveJobQueuedMock.mockResolvedValue(undefined);
    enqueueJobMock.mockResolvedValue(undefined);
    enqueueWorkerMailboxJobMock.mockResolvedValue(undefined);
    resolveManagedJobOwnerRouteMock.mockResolvedValue({
      ok: true,
      sourceJob: { job: { jobId: 'job-0' } },
      targetWorkerId: 'worker-a',
    });
  });

  it('saves and enqueues fresh jobs to the shared queue', async () => {
    const queue = { add: vi.fn() } as never;
    const queueRuntime = {
      queues: {
        jobs: queue,
      },
      publishJobToWorkerMailbox: vi.fn(),
    } as never;
    const result = await saveAndEnqueueManagedJob({
      config: makeConfig(),
      queueRuntime,
      job: makeJob(),
    });

    expect(result).toEqual({
      status: 'accepted',
      target: 'shared',
    });
    expect(resolveManagedJobOwnerRouteMock).not.toHaveBeenCalled();
    expect(saveJobQueuedMock).toHaveBeenCalledWith(expect.objectContaining({ jobId: 'ask-1' }));
    expect(enqueueJobMock).toHaveBeenCalledWith(queue, expect.objectContaining({ jobId: 'ask-1' }));
    expect(enqueueWorkerMailboxJobMock).not.toHaveBeenCalled();
  });

  it('routes resumed jobs to the owner worker mailbox when the owner is live', async () => {
    const queueRuntime = {
      queues: {
        jobs: { add: vi.fn() },
      },
      publishJobToWorkerMailbox: vi.fn(),
    } as never;
    const result = await saveAndEnqueueManagedJob({
      config: makeConfig(),
      queueRuntime,
      job: makeJob({ resumeFromJobId: 'job-0' }),
    });

    expect(result).toEqual({
      status: 'accepted',
      target: 'worker-mailbox',
      targetWorkerId: 'worker-a',
    });
    expect(resolveManagedJobOwnerRouteMock).toHaveBeenCalledWith({
      resumeFromJobId: 'job-0',
    });
    expect(saveJobQueuedMock).toHaveBeenCalledTimes(1);
    expect(enqueueWorkerMailboxJobMock).toHaveBeenCalledWith(
      queueRuntime,
      'worker-a',
      expect.objectContaining({ jobId: 'ask-1', resumeFromJobId: 'job-0' }),
    );
    expect(enqueueJobMock).not.toHaveBeenCalled();
  });

  it('rejects resumed jobs when owner routing fails before saving a new job', async () => {
    resolveManagedJobOwnerRouteMock.mockResolvedValue({
      ok: false,
      errorMessage: 'Job job-0 is waiting for owner worker worker-a to return.',
    });

    const result = await saveAndEnqueueManagedJob({
      config: makeConfig(),
      queueRuntime: {
        queues: {
          jobs: { add: vi.fn() },
        },
        publishJobToWorkerMailbox: vi.fn(),
      } as never,
      job: makeJob({ resumeFromJobId: 'job-0' }),
    });

    expect(result).toEqual({
      status: 'invalid',
      message: 'Job job-0 is waiting for owner worker worker-a to return.',
    });
    expect(saveJobQueuedMock).not.toHaveBeenCalled();
    expect(enqueueJobMock).not.toHaveBeenCalled();
    expect(enqueueWorkerMailboxJobMock).not.toHaveBeenCalled();
  });
});
