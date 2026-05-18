import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createRedisJobRegistryStore } from './registryRedisStore.js';
import type { JobRecord } from './registryTypes.js';

const hoisted = vi.hoisted(() => {
  class FakeRedisClient {
    private readonly values = new Map<string, string>();

    reset() {
      this.values.clear();
    }

    scan(cursor: string, _match: string, pattern: string): [string, string[]] {
      const prefix = pattern.endsWith('*') ? pattern.slice(0, -1) : pattern;
      const keys = [...this.values.keys()].filter((key) => key.startsWith(prefix));
      return [cursor === '0' ? '0' : '0', keys];
    }

    mget(...keys: string[]): Array<string | null> {
      return keys.map((key) => this.values.get(key) ?? null);
    }

    get(key: string): string | null {
      return this.values.get(key) ?? null;
    }

    set(key: string, value: string): 'OK' {
      this.values.set(key, value);
      return 'OK';
    }

    del(...keys: string[]): number {
      let deleted = 0;
      for (const key of keys) {
        if (this.values.delete(key)) {
          deleted += 1;
        }
      }
      return deleted;
    }

    eval(_script: string, _numKeys: number, key: string, record: string, expectedStatus: string) {
      const raw = this.values.get(key);
      if (!raw) return 0;
      const parsed = JSON.parse(raw) as JobRecord;
      if (parsed.status !== expectedStatus) return 0;
      this.values.set(key, record);
      return 1;
    }
  }

  const client = new FakeRedisClient();

  class FakeRedisConnection {
    readonly client = Promise.resolve(client);
  }

  return {
    client,
    FakeRedisConnection,
  };
});

vi.mock('bullmq', async () => {
  const actual = await vi.importActual<typeof import('bullmq')>('bullmq');
  return {
    ...actual,
    RedisConnection: hoisted.FakeRedisConnection,
  };
});

function buildRecord(jobId: string): JobRecord {
  return {
    job: {
      jobId,
      type: 'MENTION',
      repoKeys: [],
      gitRef: 'main',
      requestText: 'Reply in thread',
      channel: {
        provider: 'discord',
        channelId: 'C1',
        threadId: 'T1',
      },
    },
    status: 'running',
    createdAt: '2026-05-18T12:00:00.000Z',
    updatedAt: '2026-05-18T12:00:00.000Z',
    ownerWorkerId: 'worker-c',
    ownerWorkerLabel: 'Worker C',
    workerClaimedAt: '2026-05-18T12:01:00.000Z',
  };
}

describe('jobs/redis ownership persistence', () => {
  beforeEach(() => {
    hoisted.client.reset();
  });

  it('preserves ownership fields across save and update', async () => {
    const store = createRedisJobRegistryStore('redis://unused');
    const record = buildRecord('job-redis');

    await store.upsertRecord('job:job-redis', record);
    await expect(store.loadRecordByKey('job:job-redis')).resolves.toEqual(record);

    const updated: JobRecord = {
      ...record,
      summary: 'Resume waiting on owner',
      ownerStaleSince: '2026-05-18T12:10:00.000Z',
      updatedAt: '2026-05-18T12:10:00.000Z',
    };
    await store.upsertRecord('job:job-redis', updated);

    await expect(store.loadRecordByKey('job:job-redis')).resolves.toEqual(updated);
    await expect(store.loadAllRecordsByPrefix('job:')).resolves.toEqual([updated]);
  });
});
