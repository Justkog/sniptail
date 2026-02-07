import { eq, inArray, like } from 'drizzle-orm';
import type { PgJobRegistryClient } from '../db/index.js';
import { jobs as pgJobs } from '../db/pg/schema.js';
import { logger } from '../logger.js';
import type { JobRecord, JobRegistryStore } from './registryTypes.js';

function parsePgRecord(value: unknown): JobRecord | undefined {
  if (!value) return undefined;
  if (typeof value === 'string') {
    try {
      return JSON.parse(value) as JobRecord;
    } catch (err) {
      logger.warn({ err }, 'Failed to parse pg job record JSON');
      return undefined;
    }
  }
  if (typeof value === 'object') {
    return value as JobRecord;
  }
  return undefined;
}

export function createPgJobRegistryStore(client: PgJobRegistryClient): JobRegistryStore {
  return {
    kind: 'pg',
    async loadAllRecordsByPrefix(prefix: string): Promise<JobRecord[]> {
      const rows = await client.db
        .select({ record: pgJobs.record })
        .from(pgJobs)
        .where(like(pgJobs.jobId, `${prefix}%`));
      const records: JobRecord[] = [];
      for (const row of rows ?? []) {
        const record = parsePgRecord(row.record);
        if (record) records.push(record);
      }
      return records;
    },
    async loadRecordByKey(key: string): Promise<JobRecord | undefined> {
      const rows = await client.db
        .select({ record: pgJobs.record })
        .from(pgJobs)
        .where(eq(pgJobs.jobId, key))
        .limit(1);
      return parsePgRecord(rows[0]?.record);
    },
    async upsertRecord(key: string, record: JobRecord): Promise<void> {
      await client.db
        .insert(pgJobs)
        .values({ jobId: key, record })
        .onConflictDoUpdate({
          target: pgJobs.jobId,
          set: { record },
        });
    },
    async deleteRecordsByKeys(keys: string[]): Promise<void> {
      if (!keys.length) return;
      await client.db.delete(pgJobs).where(inArray(pgJobs.jobId, keys));
    },
    async deleteRecordByKey(key: string): Promise<void> {
      await client.db.delete(pgJobs).where(eq(pgJobs.jobId, key));
    },
  };
}
