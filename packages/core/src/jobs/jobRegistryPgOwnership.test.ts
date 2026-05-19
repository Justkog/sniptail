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

  readonly pool = {
    query: (queryText: string, values: unknown[] = []) => {
      if (queryText.includes(`record #>> '{job,channel,provider}'`)) {
        const [jobPrefix, provider, threadId, channelId] = values;
        const trailingValues = values.slice(4);
        const agentId = trailingValues.find((value) => typeof value === 'string');
        const types = trailingValues.find((value) => Array.isArray(value)) as string[] | undefined;
        const matches = Array.from(this.rows.entries())
          .filter(([key]) => key.startsWith(String(jobPrefix)))
          .map(([, record]) => record)
          .filter((record) => record.job.channel.provider === provider)
          .filter((record) => record.job.channel.threadId === threadId)
          .filter(
            (record) =>
              record.job.channel.channelId === channelId ||
              record.job.channel.channelId === threadId ||
              channelId === threadId,
          )
          .filter((record) => (agentId ? Boolean(record.job.agentThreadIds?.[agentId]) : true))
          .filter((record) => (types?.length ? types.includes(record.job.type) : true))
          .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
        return Promise.resolve({
          rows: matches.slice(0, 1).map((record) => ({ record })),
        });
      }

      if (queryText.includes(`SELECT job_id FROM jobs`)) {
        const [jobPrefix, cutoffIso] = values;
        return Promise.resolve({
          rows: Array.from(this.rows.entries())
            .filter(([key]) => key.startsWith(String(jobPrefix)))
            .filter(([, record]) => record.createdAt < String(cutoffIso))
            .map(([jobId]) => ({ job_id: jobId })),
        });
      }

      if (queryText.includes(`COUNT(*)::int AS record_count`)) {
        const [jobPrefix, types] = values as [string, string[]];
        return Promise.resolve({
          rows: [
            {
              record_count: Array.from(this.rows.entries())
                .filter(([key]) => key.startsWith(jobPrefix))
                .map(([, record]) => record)
                .filter((record) => types.includes(record.job.type)).length,
            },
          ],
        });
      }

      if (queryText.includes(`ORDER BY record->>'createdAt' ASC`)) {
        const [jobPrefix, types, maybeOlderThan, maybeLimit] = values;
        const olderThan = typeof maybeOlderThan === 'string' ? maybeOlderThan : undefined;
        const limit =
          typeof maybeLimit === 'number'
            ? maybeLimit
            : typeof maybeOlderThan === 'number'
              ? maybeOlderThan
              : undefined;
        const rows = Array.from(this.rows.entries())
          .filter(([key]) => key.startsWith(String(jobPrefix)))
          .map(([, record]) => record)
          .filter((record) => (types as string[]).includes(record.job.type))
          .filter((record) => (olderThan ? record.createdAt <= olderThan : true))
          .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
          .slice(0, limit ?? Number.MAX_SAFE_INTEGER)
          .map((record) => ({ record }));
        return Promise.resolve({ rows });
      }

      throw new Error(`Unexpected pg query in test: ${queryText}`);
    },
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
