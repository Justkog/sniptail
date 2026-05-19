import { eq, inArray, like } from 'drizzle-orm';
import type { SqliteJobRegistryClient } from '../db/index.js';
import { jobs as sqliteJobs } from '../db/sqlite/schema.js';
import { logger } from '../logger.js';
import type {
  JobRecord,
  JobRecordCleanupQuery,
  JobRecordThreadLookup,
  JobRegistryStore,
} from './registryTypes.js';

const JOB_KEY_PREFIX = 'job:';

function parseSqliteRecord(value: unknown): JobRecord | undefined {
  if (typeof value !== 'string') return undefined;
  try {
    return JSON.parse(value) as JobRecord;
  } catch (err) {
    logger.warn({ err }, 'Failed to parse sqlite job record JSON');
    return undefined;
  }
}

function parseSqliteRows(rows: Array<{ record: unknown }>): JobRecord[] {
  const records: JobRecord[] = [];
  for (const row of rows ?? []) {
    const record = parseSqliteRecord(row.record);
    if (record) records.push(record);
  }
  return records;
}

function buildCleanupWhereClause(input: JobRecordCleanupQuery): { sql: string; params: unknown[] } {
  const conditions = [
    `job_id LIKE ?`,
    `json_extract(record, '$.job.type') IN (${input.types.map(() => '?').join(', ')})`,
  ];
  const params: unknown[] = [`${JOB_KEY_PREFIX}%`, ...input.types];

  if (input.olderThan) {
    conditions.push(`json_extract(record, '$.createdAt') <= ?`);
    params.push(input.olderThan);
  }

  return {
    sql: conditions.join(' AND '),
    params,
  };
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
    // eslint-disable-next-line @typescript-eslint/require-await
    async findLatestJobRecordByChannelThread(
      input: JobRecordThreadLookup,
    ): Promise<JobRecord | undefined> {
      const conditions = [
        `job_id LIKE ?`,
        `json_extract(record, '$.job.channel.provider') = ?`,
        `json_extract(record, '$.job.channel.threadId') = ?`,
      ];
      const params: unknown[] = [`${JOB_KEY_PREFIX}%`, input.provider, input.threadId];

      if (input.provider === 'discord') {
        conditions.push(
          `(json_extract(record, '$.job.channel.channelId') = ? OR json_extract(record, '$.job.channel.channelId') = ? OR ? = ?)`,
        );
        params.push(input.channelId, input.threadId, input.channelId, input.threadId);
      } else {
        conditions.push(`json_extract(record, '$.job.channel.channelId') = ?`);
        params.push(input.channelId);
      }

      if (input.agentId) {
        conditions.push(
          `COALESCE(json_extract(record, '$.job.agentThreadIds.${input.agentId}'), '') <> ''`,
        );
      }

      if (input.types?.length) {
        conditions.push(
          `json_extract(record, '$.job.type') IN (${input.types.map(() => '?').join(', ')})`,
        );
        params.push(...input.types);
      }

      const row = client.raw
        .prepare(
          [
            `SELECT record FROM jobs`,
            `WHERE ${conditions.join(' AND ')}`,
            `ORDER BY json_extract(record, '$.createdAt') DESC`,
            `LIMIT 1`,
          ].join(' '),
        )
        .get(...params) as { record: unknown } | undefined;
      return parseSqliteRecord(row?.record);
    },
    // eslint-disable-next-line @typescript-eslint/require-await
    async listJobKeysCreatedBefore(cutoffIso: string): Promise<string[]> {
      const rows = client.raw
        .prepare(
          [
            `SELECT job_id FROM jobs`,
            `WHERE job_id LIKE ?`,
            `AND json_extract(record, '$.createdAt') < ?`,
          ].join(' '),
        )
        .all(`${JOB_KEY_PREFIX}%`, cutoffIso) as Array<{ job_id: string }>;
      return rows.map((row) => row.job_id);
    },
    // eslint-disable-next-line @typescript-eslint/require-await
    async countJobRecordsByTypes(types: string[]): Promise<number> {
      if (!types.length) return 0;
      const row = client.raw
        .prepare(
          [
            `SELECT COUNT(*) AS record_count FROM jobs`,
            `WHERE job_id LIKE ?`,
            `AND json_extract(record, '$.job.type') IN (${types.map(() => '?').join(', ')})`,
          ].join(' '),
        )
        .get(`${JOB_KEY_PREFIX}%`, ...types) as { record_count: number | string } | undefined;
      return Number(row?.record_count ?? 0);
    },
    // eslint-disable-next-line @typescript-eslint/require-await
    async listJobRecordsForCleanup(input: JobRecordCleanupQuery): Promise<JobRecord[]> {
      if (!input.types.length) return [];
      const where = buildCleanupWhereClause(input);
      const limitSql =
        typeof input.limit === 'number' && Number.isFinite(input.limit) && input.limit > 0
          ? ` LIMIT ${Math.trunc(input.limit)}`
          : '';
      const rows = client.raw
        .prepare(
          [
            `SELECT record FROM jobs`,
            `WHERE ${where.sql}`,
            `ORDER BY json_extract(record, '$.createdAt') ASC${limitSql}`,
          ].join(' '),
        )
        .all(...where.params) as Array<{ record: unknown }>;
      return parseSqliteRows(rows);
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
    // eslint-disable-next-line @typescript-eslint/require-await
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
