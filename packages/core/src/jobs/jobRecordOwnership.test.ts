import { beforeEach, describe, expect, it, vi } from 'vitest';
import { loadJobRecord, saveJobQueued, updateJobRecord } from './registry.js';
import type { JobRecord, JobRegistryStore } from './registryTypes.js';

const hoisted = vi.hoisted(() => {
  const records = new Map<string, JobRecord>();
  const store: JobRegistryStore = {
    kind: 'redis',
    loadAllRecordsByPrefix: vi.fn(async (prefix: string) =>
      Array.from(records.entries())
        .filter(([key]) => key.startsWith(prefix))
        .map(([, record]) => record),
    ),
    loadRecordByKey: vi.fn(async (key: string) => records.get(key)),
    upsertRecord: vi.fn(async (key: string, record: JobRecord) => {
      records.set(key, record);
    }),
    conditionalUpdateRecord: vi.fn(async () => false),
    deleteRecordsByKeys: vi.fn(async (keys: string[]) => {
      for (const key of keys) {
        records.delete(key);
      }
    }),
    deleteRecordByKey: vi.fn(async (key: string) => {
      records.delete(key);
    }),
  };

  return {
    records,
    store,
  };
});

vi.mock('./registryStore.js', () => ({
  getJobRegistryStore: vi.fn(async () => hoisted.store),
}));

describe('jobs/registry ownership fields', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hoisted.records.clear();
  });

  it('preserves owner metadata when applying unrelated patches', async () => {
    await saveJobQueued({
      jobId: 'job-1',
      type: 'ASK',
      repoKeys: ['repo-1'],
      gitRef: 'main',
      requestText: 'Investigate',
      channel: {
        provider: 'slack',
        channelId: 'C1',
        threadId: 'T1',
        userId: 'U1',
      },
    });

    await updateJobRecord('job-1', {
      ownerWorkerId: 'worker-a',
      ownerWorkerLabel: 'Worker A',
      workerClaimedAt: '2026-05-18T09:00:00.000Z',
    });
    await updateJobRecord('job-1', {
      summary: 'Done',
      status: 'ok',
    });

    await expect(loadJobRecord('job-1')).resolves.toMatchObject({
      status: 'ok',
      summary: 'Done',
      ownerWorkerId: 'worker-a',
      ownerWorkerLabel: 'Worker A',
      workerClaimedAt: '2026-05-18T09:00:00.000Z',
    });
  });

  it('updates stale-owner metadata without dropping existing ownership', async () => {
    hoisted.records.set('job:job-2', {
      job: {
        jobId: 'job-2',
        type: 'RUN',
        repoKeys: ['repo-1'],
        gitRef: 'main',
        requestText: 'Run action',
        channel: {
          provider: 'discord',
          channelId: 'C1',
          threadId: 'T1',
        },
      },
      status: 'queued',
      createdAt: '2026-05-18T09:00:00.000Z',
      updatedAt: '2026-05-18T09:00:00.000Z',
      ownerWorkerId: 'worker-b',
      ownerWorkerLabel: 'Worker B',
      workerClaimedAt: '2026-05-18T09:01:00.000Z',
    });

    const updated = await updateJobRecord('job-2', {
      ownerStaleSince: '2026-05-18T09:10:00.000Z',
    });

    expect(updated).toMatchObject({
      ownerWorkerId: 'worker-b',
      ownerWorkerLabel: 'Worker B',
      workerClaimedAt: '2026-05-18T09:01:00.000Z',
      ownerStaleSince: '2026-05-18T09:10:00.000Z',
    });
  });
});
