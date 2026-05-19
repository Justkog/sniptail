import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { JobRecord } from '@sniptail/core/jobs/registryTypes.js';
import { resolveManagedJobOwnerRoute } from './ownerRouting.js';

const hoisted = vi.hoisted(() => ({
  loadJobRecord: vi.fn(),
  updateJobRecord: vi.fn(),
  loadAggregatedAgentCapabilitySnapshot: vi.fn(),
}));

vi.mock('@sniptail/core/jobs/registry.js', () => ({
  loadJobRecord: hoisted.loadJobRecord,
  updateJobRecord: hoisted.updateJobRecord,
}));

vi.mock('@sniptail/core/registry/registryCapabilities.js', () => ({
  loadAggregatedAgentCapabilitySnapshot: hoisted.loadAggregatedAgentCapabilitySnapshot,
}));

function buildJobRecord(overrides: Partial<JobRecord> = {}): JobRecord {
  return {
    job: {
      jobId: 'job-1',
      type: 'ASK',
      repoKeys: ['repo-a'],
      requestText: 'What changed?',
      channel: {
        provider: 'slack',
        channelId: 'C1',
        userId: 'U1',
        threadId: '123.456',
      },
      agent: 'codex',
    },
    status: 'running',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ownerWorkerId: 'worker-a',
    ownerWorkerLabel: 'Worker A',
    workerClaimedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('resolveManagedJobOwnerRoute', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hoisted.loadAggregatedAgentCapabilitySnapshot.mockResolvedValue({
      aggregated: {
        liveWorkers: [],
      },
    });
    hoisted.updateJobRecord.mockResolvedValue(undefined);
  });

  it('returns a clear error when the source job is missing', async () => {
    hoisted.loadJobRecord.mockResolvedValue(undefined);

    const result = await resolveManagedJobOwnerRoute({ resumeFromJobId: 'job-missing' });

    expect(result).toEqual({
      ok: false,
      errorMessage: 'Job job-missing was not found, so it cannot be resumed.',
    });
    expect(hoisted.loadAggregatedAgentCapabilitySnapshot).not.toHaveBeenCalled();
    expect(hoisted.updateJobRecord).not.toHaveBeenCalled();
  });

  it('returns a clear error when the source job has no owner worker', async () => {
    hoisted.loadJobRecord.mockResolvedValue(buildJobRecord({ ownerWorkerId: undefined }));

    const result = await resolveManagedJobOwnerRoute({ resumeFromJobId: 'job-1' });

    expect(result).toMatchObject({
      ok: false,
      errorMessage: 'Job job-1 has no owner worker and cannot be resumed safely.',
      sourceJob: {
        job: {
          jobId: 'job-1',
        },
      },
    });
    expect(hoisted.loadAggregatedAgentCapabilitySnapshot).not.toHaveBeenCalled();
    expect(hoisted.updateJobRecord).not.toHaveBeenCalled();
  });

  it('marks the owner stale when the owner worker is no longer live', async () => {
    hoisted.loadJobRecord.mockResolvedValue(buildJobRecord());
    hoisted.updateJobRecord.mockResolvedValue(
      buildJobRecord({ ownerStaleSince: '2026-01-01T00:10:00.000Z' }),
    );

    const result = await resolveManagedJobOwnerRoute({ resumeFromJobId: 'job-1' });

    expect(result.ok).toBe(false);
    expect(hoisted.loadAggregatedAgentCapabilitySnapshot).toHaveBeenCalledTimes(1);
    expect(hoisted.updateJobRecord).toHaveBeenCalledWith(
      'job-1',
      expect.objectContaining({
        ownerWorkerId: 'worker-a',
        ownerWorkerLabel: 'Worker A',
        workerClaimedAt: '2026-01-01T00:00:00.000Z',
      }),
    );
    expect(result).toMatchObject({
      errorMessage: 'Job job-1 is waiting for owner worker Worker A (worker-a) to return.',
      sourceJob: {
        ownerStaleSince: '2026-01-01T00:10:00.000Z',
      },
    });
  });

  it('does not rewrite ownerStaleSince when the owner is already stale', async () => {
    hoisted.loadJobRecord.mockResolvedValue(
      buildJobRecord({ ownerStaleSince: '2026-01-01T00:10:00.000Z' }),
    );

    const result = await resolveManagedJobOwnerRoute({ resumeFromJobId: 'job-1' });

    expect(result).toMatchObject({
      ok: false,
      errorMessage: 'Job job-1 is waiting for owner worker Worker A (worker-a) to return.',
      sourceJob: {
        ownerStaleSince: '2026-01-01T00:10:00.000Z',
      },
    });
    expect(hoisted.updateJobRecord).not.toHaveBeenCalled();
  });

  it('returns the owner worker when the owner is live', async () => {
    hoisted.loadJobRecord.mockResolvedValue(buildJobRecord());
    hoisted.loadAggregatedAgentCapabilitySnapshot.mockResolvedValue({
      aggregated: {
        liveWorkers: [
          {
            workerId: 'worker-a',
            workerLabel: 'Worker A',
          },
        ],
      },
    });

    const result = await resolveManagedJobOwnerRoute({ resumeFromJobId: 'job-1' });

    expect(result).toMatchObject({
      ok: true,
      targetWorkerId: 'worker-a',
      sourceJob: {
        job: {
          jobId: 'job-1',
        },
      },
    });
    expect(hoisted.updateJobRecord).not.toHaveBeenCalled();
  });

  it('clears stale-owner state and refreshes the owner label when the owner is live again', async () => {
    hoisted.loadJobRecord.mockResolvedValue(
      buildJobRecord({
        ownerWorkerLabel: 'Old Worker A',
        ownerStaleSince: '2026-01-01T00:10:00.000Z',
      }),
    );
    hoisted.loadAggregatedAgentCapabilitySnapshot.mockResolvedValue({
      aggregated: {
        liveWorkers: [
          {
            workerId: 'worker-a',
            workerLabel: 'Worker A',
          },
        ],
      },
    });
    hoisted.updateJobRecord.mockResolvedValue(
      buildJobRecord({
        ownerWorkerLabel: 'Worker A',
        ownerStaleSince: undefined,
      }),
    );

    const result = await resolveManagedJobOwnerRoute({ resumeFromJobId: 'job-1' });

    expect(result).toMatchObject({
      ok: true,
      targetWorkerId: 'worker-a',
      sourceJob: {
        ownerWorkerLabel: 'Worker A',
        ownerStaleSince: undefined,
      },
    });
    expect(hoisted.updateJobRecord).toHaveBeenCalledWith('job-1', {
      ownerWorkerId: 'worker-a',
      ownerWorkerLabel: 'Worker A',
      workerClaimedAt: '2026-01-01T00:00:00.000Z',
      ownerStaleSince: undefined,
    });
  });
});
