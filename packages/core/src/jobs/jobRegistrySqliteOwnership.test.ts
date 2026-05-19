import { afterEach, describe, expect, it } from 'vitest';
import { closeJobRegistryDb, getJobRegistryDb } from '../db/index.js';
import { resetConfigCaches } from '../config/env.js';
import { applyRequiredEnv } from '../../tests/helpers/env.js';
import { createSqliteJobRegistryStore } from './registrySqliteStore.js';
import type { JobRecord } from './registryTypes.js';

describe('jobs/sqlite ownership persistence', () => {
  afterEach(async () => {
    await closeJobRegistryDb();
    resetConfigCaches();
  });

  async function ensureJobsTable() {
    const client = await getJobRegistryDb();
    if (client.kind !== 'sqlite') {
      throw new Error('Expected sqlite client in test');
    }
    client.raw
      .prepare('CREATE TABLE IF NOT EXISTS jobs (job_id text PRIMARY KEY, record text NOT NULL)')
      .run();
    return client;
  }

  function buildRecord(jobId: string): JobRecord {
    return {
      job: {
        jobId,
        type: 'PLAN',
        repoKeys: ['repo-1'],
        gitRef: 'main',
        requestText: 'Plan migration',
        channel: {
          provider: 'slack',
          channelId: 'C1',
          threadId: 'T1',
          userId: 'U1',
        },
      },
      status: 'running',
      createdAt: '2026-05-18T10:00:00.000Z',
      updatedAt: '2026-05-18T10:00:00.000Z',
      ownerWorkerId: 'worker-a',
      ownerWorkerLabel: 'Worker A',
      workerClaimedAt: '2026-05-18T10:01:00.000Z',
    };
  }

  it('preserves ownership fields across save and update', async () => {
    applyRequiredEnv({ SNIPTAIL_REGISTRY_DB: 'sqlite' });
    const client = await ensureJobsTable();
    const store = createSqliteJobRegistryStore(client);

    const record = buildRecord('job-sqlite');
    await store.upsertRecord('job:job-sqlite', record);

    await expect(store.loadRecordByKey('job:job-sqlite')).resolves.toEqual(record);

    const updated: JobRecord = {
      ...record,
      summary: 'Queued for resume',
      ownerStaleSince: '2026-05-18T10:05:00.000Z',
      updatedAt: '2026-05-18T10:05:00.000Z',
    };
    await store.upsertRecord('job:job-sqlite', updated);

    await expect(store.loadRecordByKey('job:job-sqlite')).resolves.toEqual(updated);
    await expect(store.loadAllRecordsByPrefix('job:')).resolves.toEqual([updated]);
  });

  it('pushes latest thread lookup and cleanup queries into sqlite', async () => {
    applyRequiredEnv({ SNIPTAIL_REGISTRY_DB: 'sqlite' });
    const client = await ensureJobsTable();
    const store = createSqliteJobRegistryStore(client);

    await store.upsertRecord('job:job-older', {
      job: {
        jobId: 'job-older',
        type: 'EXPLORE',
        repoKeys: ['repo-1'],
        gitRef: 'main',
        requestText: 'Older',
        channel: {
          provider: 'discord',
          channelId: 'parent-1',
          threadId: 'thread-1',
        },
        agentThreadIds: {
          codex: 'agent-thread-older',
        },
      },
      status: 'ok',
      createdAt: '2026-05-18T10:00:00.000Z',
      updatedAt: '2026-05-18T10:00:00.000Z',
    });
    await store.upsertRecord('job:job-latest', {
      job: {
        jobId: 'job-latest',
        type: 'EXPLORE',
        repoKeys: ['repo-1'],
        gitRef: 'main',
        requestText: 'Latest',
        channel: {
          provider: 'discord',
          channelId: 'thread-1',
          threadId: 'thread-1',
        },
        agentThreadIds: {
          codex: 'agent-thread-latest',
        },
      },
      status: 'ok',
      createdAt: '2026-05-18T11:00:00.000Z',
      updatedAt: '2026-05-18T11:00:00.000Z',
    });
    await store.upsertRecord('job:job-implement', {
      job: {
        jobId: 'job-implement',
        type: 'IMPLEMENT',
        repoKeys: ['repo-1'],
        gitRef: 'main',
        requestText: 'Implement',
        channel: {
          provider: 'slack',
          channelId: 'C1',
          threadId: 'T1',
          userId: 'U1',
        },
      },
      status: 'ok',
      createdAt: '2026-05-18T12:00:00.000Z',
      updatedAt: '2026-05-18T12:00:00.000Z',
    });

    await expect(
      store.findLatestJobRecordByChannelThread({
        provider: 'discord',
        channelId: 'parent-1',
        threadId: 'thread-1',
        types: ['EXPLORE'],
      }),
    ).resolves.toMatchObject({
      job: {
        jobId: 'job-latest',
      },
    });

    await expect(store.listJobKeysCreatedBefore('2026-05-18T11:30:00.000Z')).resolves.toEqual([
      'job:job-older',
      'job:job-latest',
    ]);
    await expect(store.countJobRecordsByTypes(['EXPLORE', 'IMPLEMENT'])).resolves.toBe(3);
    await expect(
      store.listJobRecordsForCleanup({
        types: ['EXPLORE', 'IMPLEMENT'],
        limit: 2,
      }),
    ).resolves.toMatchObject([{ job: { jobId: 'job-older' } }, { job: { jobId: 'job-latest' } }]);
  });
});
