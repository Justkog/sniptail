import { and, eq, inArray, like, sql } from 'drizzle-orm';
import type { PgJobRegistryClient } from '../db/index.js';
import { jobs as pgJobs } from '../db/pg/schema.js';
import { logger } from '../logger.js';
import type {
  JobRecord,
  JobRecordCleanupQuery,
  JobRecordThreadLookup,
  JobRegistryStore,
} from './registryTypes.js';

const JOB_KEY_PREFIX = 'job:';

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

function parsePgRows(rows: Array<{ record: unknown }>): JobRecord[] {
  const records: JobRecord[] = [];
  for (const row of rows ?? []) {
    const record = parsePgRecord(row.record);
    if (record) records.push(record);
  }
  return records;
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
    async findLatestJobRecordByChannelThread(
      input: JobRecordThreadLookup,
    ): Promise<JobRecord | undefined> {
      const conditions = [
        `job_id LIKE $1`,
        `record #>> '{job,channel,provider}' = $2`,
        `record #>> '{job,channel,threadId}' = $3`,
      ];
      const values: unknown[] = [`${JOB_KEY_PREFIX}%`, input.provider, input.threadId];

      if (input.provider === 'discord') {
        values.push(input.channelId);
        const channelIdIndex = values.length;
        conditions.push(
          `($${channelIdIndex} = $3 OR record #>> '{job,channel,channelId}' = $${channelIdIndex} OR record #>> '{job,channel,channelId}' = $3)`,
        );
      } else {
        values.push(input.channelId);
        conditions.push(`record #>> '{job,channel,channelId}' = $${values.length}`);
      }

      if (input.agentId) {
        values.push(input.agentId);
        conditions.push(
          `COALESCE(jsonb_extract_path_text(record, 'job', 'agentThreadIds', $${values.length}), '') <> ''`,
        );
      }

      if (input.types?.length) {
        values.push(input.types);
        conditions.push(`record #>> '{job,type}' = ANY($${values.length}::text[])`);
      }

      const result = await client.pool.query<{ record: unknown }>(
        [
          `SELECT record FROM jobs`,
          `WHERE ${conditions.join(' AND ')}`,
          `ORDER BY record->>'createdAt' DESC`,
          `LIMIT 1`,
        ].join(' '),
        values,
      );
      return parsePgRecord(result.rows[0]?.record);
    },
    async listJobKeysCreatedBefore(cutoffIso: string): Promise<string[]> {
      const result = await client.pool.query<{ job_id: string }>(
        [`SELECT job_id FROM jobs`, `WHERE job_id LIKE $1`, `AND record->>'createdAt' < $2`].join(
          ' ',
        ),
        [`${JOB_KEY_PREFIX}%`, cutoffIso],
      );
      return result.rows.map((row) => row.job_id);
    },
    async countJobRecordsByTypes(types: string[]): Promise<number> {
      if (!types.length) return 0;
      const result = await client.pool.query<{ record_count: number | string }>(
        [
          `SELECT COUNT(*)::int AS record_count FROM jobs`,
          `WHERE job_id LIKE $1`,
          `AND record #>> '{job,type}' = ANY($2::text[])`,
        ].join(' '),
        [`${JOB_KEY_PREFIX}%`, types],
      );
      return Number(result.rows[0]?.record_count ?? 0);
    },
    async listJobRecordsForCleanup(input: JobRecordCleanupQuery): Promise<JobRecord[]> {
      if (!input.types.length) return [];
      const conditions = [`job_id LIKE $1`, `record #>> '{job,type}' = ANY($2::text[])`];
      const values: unknown[] = [`${JOB_KEY_PREFIX}%`, input.types];

      if (input.olderThan) {
        values.push(input.olderThan);
        conditions.push(`record->>'createdAt' <= $${values.length}`);
      }

      let limitSql = '';
      if (typeof input.limit === 'number' && Number.isFinite(input.limit) && input.limit > 0) {
        values.push(Math.trunc(input.limit));
        limitSql = ` LIMIT $${values.length}`;
      }

      const result = await client.pool.query<{ record: unknown }>(
        [
          `SELECT record FROM jobs`,
          `WHERE ${conditions.join(' AND ')}`,
          `ORDER BY record->>'createdAt' ASC${limitSql}`,
        ].join(' '),
        values,
      );
      return parsePgRows(result.rows);
    },
    async upsertRecord(key: string, record: JobRecord): Promise<void> {
      await client.db.insert(pgJobs).values({ jobId: key, record }).onConflictDoUpdate({
        target: pgJobs.jobId,
        set: { record },
      });
    },
    async conditionalUpdateRecord(
      key: string,
      record: JobRecord,
      condition: { statusEquals: string },
    ): Promise<boolean> {
      const rows = await client.db
        .update(pgJobs)
        .set({ record })
        .where(
          and(
            eq(pgJobs.jobId, key),
            sql`(${pgJobs.record}->>'status') = ${condition.statusEquals}`,
          ),
        )
        .returning({ jobId: pgJobs.jobId });
      return rows.length > 0;
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
