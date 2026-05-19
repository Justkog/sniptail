import { beforeEach, describe, expect, it, vi } from 'vitest';
import { clearJobsBefore, loadJobRecord, saveJobQueued, updateJobRecord } from './registry.js';
import type { JobRecord, JobRegistryStore } from './registryTypes.js';

const hoisted = vi.hoisted(() => {
  const records = new Map<string, JobRecord>();
  const store: JobRegistryStore = {
    kind: 'redis',
    loadAllRecordsByPrefix: vi.fn((prefix: string) =>
      Promise.resolve(
        Array.from(records.entries())
          .filter(([key]) => key.startsWith(prefix))
          .map(([, record]) => record),
      ),
    ),
    loadRecordByKey: vi.fn((key: string) => Promise.resolve(records.get(key))),
    findLatestJobRecordByChannelThread: vi.fn(() => Promise.resolve(undefined)),
    listJobKeysCreatedBefore: vi.fn(() => Promise.resolve([])),
    countJobRecordsByTypes: vi.fn(() => Promise.resolve(0)),
    listJobRecordsForCleanup: vi.fn(() => Promise.resolve([])),
    upsertRecord: vi.fn((key: string, record: JobRecord) => {
      records.set(key, record);
      return Promise.resolve();
    }),
    conditionalUpdateRecord: vi.fn(() => Promise.resolve(false)),
    deleteRecordsByKeys: vi.fn((keys: string[]) => {
      for (const key of keys) {
        records.delete(key);
      }
      return Promise.resolve();
    }),
    deleteRecordByKey: vi.fn((key: string) => {
      records.delete(key);
      return Promise.resolve();
    }),
  };

  return {
    records,
    store,
    loadCoreConfig: vi.fn(() => ({
      jobWorkRoot: '/tmp/sniptail-jobs',
    })),
  };
});

vi.mock('../config/config.js', () => ({
  loadCoreConfig: hoisted.loadCoreConfig,
}));

vi.mock('./registryStore.js', () => ({
  getJobRegistryStore: vi.fn(() => hoisted.store),
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

  it('clears old jobs through the store query instead of loading all records', async () => {
    hoisted.store.listJobKeysCreatedBefore = vi
      .fn<JobRegistryStore['listJobKeysCreatedBefore']>()
      .mockResolvedValueOnce(['job:job-3', 'job:job-4']);
    // eslint-disable-next-line @typescript-eslint/unbound-method
    const listJobKeysCreatedBeforeMock = vi.mocked(hoisted.store.listJobKeysCreatedBefore);
    // eslint-disable-next-line @typescript-eslint/unbound-method
    const loadAllRecordsByPrefixMock = vi.mocked(hoisted.store.loadAllRecordsByPrefix);
    // eslint-disable-next-line @typescript-eslint/unbound-method
    const deleteRecordsByKeysMock = vi.mocked(hoisted.store.deleteRecordsByKeys);

    await expect(clearJobsBefore(new Date('2026-05-18T10:00:00.000Z'))).resolves.toBe(2);

    expect(listJobKeysCreatedBeforeMock).toHaveBeenCalledWith('2026-05-18T10:00:00.000Z');
    expect(loadAllRecordsByPrefixMock).not.toHaveBeenCalled();
    expect(deleteRecordsByKeysMock).toHaveBeenCalledWith(['job:job-3', 'job:job-4']);
  });
});
