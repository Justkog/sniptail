import { eq, inArray, like } from 'drizzle-orm';
import type { SqliteJobRegistryClient } from '../db/index.js';
import { jobs as sqliteJobs } from '../db/sqlite/schema.js';
import { logger } from '../logger.js';
import type { JobRecord, JobRegistryStore } from './registryTypes.js';

function parseSqliteRecord(value: unknown): JobRecord | undefined {
  if (typeof value !== 'string') return undefined;
  try {
    return JSON.parse(value) as JobRecord;
  } catch (err) {
    logger.warn({ err }, 'Failed to parse sqlite job record JSON');
    return undefined;
  }
}

export function createSqliteJobRegistryStore(client: SqliteJobRegistryClient): JobRegistryStore {
  return {
    kind: 'sqlite',
    async loadAllRecordsByPrefix(prefix: string): Promise<JobRecord[]> {
      const rows = await client.db
        .select({ record: sqliteJobs.record })
        .from(sqliteJobs)
        .where(like(sqliteJobs.jobId, `${prefix}%`));
      const records: JobRecord[] = [];
      for (const row of rows ?? []) {
        const record = parseSqliteRecord(row.record);
        if (record) records.push(record);
      }
      return records;
    },
    async loadRecordByKey(key: string): Promise<JobRecord | undefined> {
      const rows = await client.db
        .select({ record: sqliteJobs.record })
        .from(sqliteJobs)
        .where(eq(sqliteJobs.jobId, key))
        .limit(1);
      return parseSqliteRecord(rows[0]?.record);
    },
    async upsertRecord(key: string, record: JobRecord): Promise<void> {
      const serialized = JSON.stringify(record);
      await client.db
        .insert(sqliteJobs)
        .values({ jobId: key, record: serialized })
        .onConflictDoUpdate({
          target: sqliteJobs.jobId,
          set: { record: serialized },
        });
    },
    async conditionalUpdateRecord(
      key: string,
      record: JobRecord,
      condition: { statusEquals: string },
    ): Promise<boolean> {
      const serialized = JSON.stringify(record);
      const result = client.raw
        .prepare(
          `UPDATE jobs SET record = ? WHERE job_id = ? AND json_extract(record, '$.status') = ?`,
        )
        .run(serialized, key, condition.statusEquals);
      return result.changes > 0;
    },
    async deleteRecordsByKeys(keys: string[]): Promise<void> {
      if (!keys.length) return;
      await client.db.delete(sqliteJobs).where(inArray(sqliteJobs.jobId, keys));
    },
    async deleteRecordByKey(key: string): Promise<void> {
      await client.db.delete(sqliteJobs).where(eq(sqliteJobs.jobId, key));
    },
  };
}
