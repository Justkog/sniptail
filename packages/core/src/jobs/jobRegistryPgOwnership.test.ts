import { describe, expect, it } from 'vitest';
import { createPgJobRegistryStore } from './registryPgStore.js';
import type { JobRecord } from './registryTypes.js';

type StoredRow = {
  jobId: string;
  record: JobRecord;
};

function createAwaitableRows(rows: Array<{ record: JobRecord }>) {
  return {
    limit: (count: number) => Promise.resolve(rows.slice(0, count)),
    then<TResult1 = Array<{ record: JobRecord }>, TResult2 = never>(
      onfulfilled?:
        | ((value: Array<{ record: JobRecord }>) => TResult1 | PromiseLike<TResult1>)
        | null,
      onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
    ) {
      return Promise.resolve(rows).then(onfulfilled, onrejected);
    },
  };
}

class FakePgClient {
  private readonly rows = new Map<string, JobRecord>();

  readonly db = {
    select: () => ({
      from: () => ({
        where: () =>
          createAwaitableRows(
            Array.from(this.rows.values()).map((record) => ({
              record,
            })),
          ),
      }),
    }),
    insert: () => ({
      values: ({ jobId, record }: StoredRow) => ({
        onConflictDoUpdate: () => {
          this.rows.set(jobId, record);
          return Promise.resolve();
        },
      }),
    }),
    update: () => ({
      set: ({ record }: { record: JobRecord }) => ({
        where: () => ({
          returning: () => {
            const firstKey = this.rows.keys().next().value;
            if (!firstKey) return Promise.resolve([]);
            this.rows.set(firstKey, record);
            return Promise.resolve([{ jobId: firstKey }]);
          },
        }),
      }),
    }),
    delete: () => ({
      where: () => Promise.resolve(undefined),
    }),
  };
}

function buildRecord(jobId: string): JobRecord {
  return {
    job: {
      jobId,
      type: 'REVIEW',
      repoKeys: ['repo-1'],
      gitRef: 'main',
      requestText: 'Review changes',
      channel: {
        provider: 'discord',
        channelId: 'C1',
        threadId: 'T1',
      },
    },
    status: 'running',
    createdAt: '2026-05-18T11:00:00.000Z',
    updatedAt: '2026-05-18T11:00:00.000Z',
    ownerWorkerId: 'worker-b',
    ownerWorkerLabel: 'Worker B',
    workerClaimedAt: '2026-05-18T11:01:00.000Z',
  };
}

describe('jobs/pg ownership persistence', () => {
  it('preserves ownership fields across save and update', async () => {
    const client = new FakePgClient();
    const store = createPgJobRegistryStore(client as never);

    const record = buildRecord('job-pg');
    await store.upsertRecord('job:job-pg', record);

    await expect(store.loadRecordByKey('job:job-pg')).resolves.toEqual(record);

    const updated: JobRecord = {
      ...record,
      summary: 'Resume blocked',
      ownerStaleSince: '2026-05-18T11:10:00.000Z',
      updatedAt: '2026-05-18T11:10:00.000Z',
    };
    await store.upsertRecord('job:job-pg', updated);

    await expect(store.loadRecordByKey('job:job-pg')).resolves.toEqual(updated);
    await expect(store.loadAllRecordsByPrefix('job:')).resolves.toEqual([updated]);
  });
});
