import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { eq, inArray, like } from 'drizzle-orm';
import { loadCoreConfig, loadWorkerConfig } from '../config/config.js';
import { getJobRegistryDb, type JobRegistryClient } from '../db/index.js';
import { jobs as pgJobs } from '../db/pg/schema.js';
import { jobs as sqliteJobs } from '../db/sqlite/schema.js';
import { logger } from '../logger.js';
import type { AgentId, JobSpec, JobType, MergeRequestResult } from '../types/job.js';

const config = loadCoreConfig();

const JOB_KEY_PREFIX = 'job:';

export type JobStatus = 'queued' | 'running' | 'ok' | 'failed';

export type JobRecord = {
  job: JobSpec;
  status: JobStatus;
  createdAt: string;
  updatedAt: string;
  branchByRepo?: Record<string, string>;
  deleteAt?: string;
  summary?: string;
  mergeRequests?: MergeRequestResult[];
  error?: string;
};

export function parseCleanupDurationMs(raw: string): number {
  const value = raw.trim();
  if (!value) {
    throw new Error('cleanup_max_age must be a non-empty duration string.');
  }
  const match = value.match(/^(\d+)([smhd])$/i);
  if (!match) {
    throw new Error(`Invalid cleanup_max_age duration: ${raw}. Expected format like "7d".`);
  }
  const amount = Number.parseInt(match[1], 10);
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error(`Invalid cleanup_max_age duration: ${raw}. Expected a positive value.`);
  }
  const unit = match[2].toLowerCase();
  switch (unit) {
    case 's':
      return amount * 1000;
    case 'm':
      return amount * 60_000;
    case 'h':
      return amount * 3_600_000;
    case 'd':
      return amount * 86_400_000;
    default:
      throw new Error(`Invalid cleanup_max_age duration unit: ${raw}.`);
  }
}

export function selectJobIdsBeyondMaxEntries(records: JobRecord[], maxEntries: number): string[] {
  if (!Number.isInteger(maxEntries) || maxEntries < 0) {
    throw new Error('cleanup_max_entries must be a non-negative integer.');
  }
  const sorted = [...records].sort((a, b) => {
    const aTime = Date.parse(a.createdAt);
    const bTime = Date.parse(b.createdAt);
    const safeATime = Number.isNaN(aTime) ? 0 : aTime;
    const safeBTime = Number.isNaN(bTime) ? 0 : bTime;
    return safeBTime - safeATime;
  });
  return sorted.slice(maxEntries).map((record) => record.job.jobId);
}

function jobKey(jobId: string) {
  return `${JOB_KEY_PREFIX}${jobId}`;
}

function jobIdFromKey(key: string) {
  return key.startsWith(JOB_KEY_PREFIX) ? key.slice(JOB_KEY_PREFIX.length) : key;
}

function removeJobRoot(jobId: string) {
  const jobRoot = join(config.jobWorkRoot, jobId);
  return rm(jobRoot, { recursive: true, force: true })
    .then(() => {
      logger.info({ jobId, jobRoot }, 'Cleared expired job data');
    })
    .catch((err) => {
      logger.warn({ err, jobId, jobRoot }, 'Failed to clear expired job data');
    });
}

function parseRecordValue(value: unknown): JobRecord | undefined {
  if (!value) return undefined;
  if (typeof value === 'string') {
    try {
      return JSON.parse(value) as JobRecord;
    } catch (err) {
      logger.warn({ err }, 'Failed to parse job record JSON');
      return undefined;
    }
  }
  if (typeof value === 'object') {
    return value as JobRecord;
  }
  return undefined;
}

function serializeRecord(kind: JobRegistryClient['kind'], record: JobRecord): unknown {
  return kind === 'pg' ? record : JSON.stringify(record);
}

async function getDbContext() {
  const client = await getJobRegistryDb();
  if (client.kind === 'pg') {
    return { kind: 'pg' as const, client, jobsTable: pgJobs };
  }
  return { kind: 'sqlite' as const, client, jobsTable: sqliteJobs };
}

async function loadAllRecords(): Promise<JobRecord[]> {
  const ctx = await getDbContext();
  const rows =
    ctx.kind === 'pg'
      ? await ctx.client.db
          .select({ record: ctx.jobsTable.record })
          .from(ctx.jobsTable)
          .where(like(ctx.jobsTable.jobId, `${JOB_KEY_PREFIX}%`))
      : await ctx.client.db
          .select({ record: ctx.jobsTable.record })
          .from(ctx.jobsTable)
          .where(like(ctx.jobsTable.jobId, `${JOB_KEY_PREFIX}%`));
  const records: JobRecord[] = [];
  for (const row of rows ?? []) {
    const record = parseRecordValue(row.record);
    if (record) records.push(record);
  }
  return records;
}

export async function loadJobRecord(jobId: string): Promise<JobRecord | undefined> {
  const ctx = await getDbContext();
  const rows =
    ctx.kind === 'pg'
      ? await ctx.client.db
          .select({ record: ctx.jobsTable.record })
          .from(ctx.jobsTable)
          .where(eq(ctx.jobsTable.jobId, jobKey(jobId)))
          .limit(1)
      : await ctx.client.db
          .select({ record: ctx.jobsTable.record })
          .from(ctx.jobsTable)
          .where(eq(ctx.jobsTable.jobId, jobKey(jobId)))
          .limit(1);
  return parseRecordValue(rows[0]?.record);
}

export async function saveJobQueued(job: JobSpec): Promise<JobRecord> {
  const ctx = await getDbContext();
  const now = new Date().toISOString();
  const record: JobRecord = {
    job,
    status: 'queued',
    createdAt: now,
    updatedAt: now,
  };
  const key = jobKey(job.jobId);
  const serialized = serializeRecord(ctx.client.kind, record);
  if (ctx.kind === 'pg') {
    await ctx.client.db
      .insert(ctx.jobsTable)
      .values({ jobId: key, record: serialized })
      .onConflictDoUpdate({
        target: ctx.jobsTable.jobId,
        set: { record: serialized },
      });
  } else {
    await ctx.client.db
      .insert(ctx.jobsTable)
      .values({ jobId: key, record: serialized as string })
      .onConflictDoUpdate({
        target: ctx.jobsTable.jobId,
        set: { record: serialized as string },
      });
  }
  await runRetentionCleanup().catch((err) => {
    logger.warn({ err, jobId: job.jobId }, 'Failed to run job retention cleanup');
  });
  return record;
}

export async function updateJobRecord(
  jobId: string,
  patch: Partial<JobRecord>,
): Promise<JobRecord> {
  const ctx = await getDbContext();
  const existing = await loadJobRecord(jobId);
  if (!existing) {
    throw new Error(`Job record not found for ${jobId}`);
  }
  const updated: JobRecord = {
    ...existing,
    ...patch,
    job: patch.job ?? existing.job,
    updatedAt: new Date().toISOString(),
  };
  const key = jobKey(jobId);
  const serialized = serializeRecord(ctx.client.kind, updated);
  if (ctx.kind === 'pg') {
    await ctx.client.db
      .insert(ctx.jobsTable)
      .values({ jobId: key, record: serialized })
      .onConflictDoUpdate({
        target: ctx.jobsTable.jobId,
        set: { record: serialized },
      });
  } else {
    await ctx.client.db
      .insert(ctx.jobsTable)
      .values({ jobId: key, record: serialized as string })
      .onConflictDoUpdate({
        target: ctx.jobsTable.jobId,
        set: { record: serialized as string },
      });
  }
  return updated;
}

export async function markJobForDeletion(jobId: string, ttlMs: number): Promise<JobRecord> {
  const ctx = await getDbContext();
  const existing = await loadJobRecord(jobId);
  if (!existing) {
    throw new Error(`Job record not found for ${jobId}`);
  }
  const deleteAt = new Date(Date.now() + ttlMs).toISOString();
  const updated: JobRecord = {
    ...existing,
    deleteAt,
    updatedAt: new Date().toISOString(),
  };
  const key = jobKey(jobId);
  const serialized = serializeRecord(ctx.client.kind, updated);
  if (ctx.kind === 'pg') {
    await ctx.client.db
      .insert(ctx.jobsTable)
      .values({ jobId: key, record: serialized })
      .onConflictDoUpdate({
        target: ctx.jobsTable.jobId,
        set: { record: serialized },
      });
  } else {
    await ctx.client.db
      .insert(ctx.jobsTable)
      .values({ jobId: key, record: serialized as string })
      .onConflictDoUpdate({
        target: ctx.jobsTable.jobId,
        set: { record: serialized as string },
      });
  }
  setTimeout(() => {
    getDbContext()
      .then(async (timerCtx) => {
        if (timerCtx.kind === 'pg') {
          await timerCtx.client.db
            .delete(timerCtx.jobsTable)
            .where(eq(timerCtx.jobsTable.jobId, key));
        } else {
          await timerCtx.client.db
            .delete(timerCtx.jobsTable)
            .where(eq(timerCtx.jobsTable.jobId, key));
        }
        await removeJobRoot(jobId);
      })
      .catch((err) => logger.warn({ err, jobId }, 'Failed to delete expired job record'));
  }, ttlMs);
  return updated;
}

export async function findLatestJobByChannelThread(
  provider: 'slack' | 'discord',
  channelId: string,
  threadId: string,
  agentId: AgentId,
): Promise<JobRecord | undefined> {
  const records = await loadAllRecords();
  let latestWithThreadId: JobRecord | undefined;
  let latestTime = -1;

  for (const record of records) {
    const channel = record?.job?.channel;
    if (!channel || channel.provider !== provider) continue;
    if (channel.channelId !== channelId || channel.threadId !== threadId) continue;
    const agentThreadId = record.job?.agentThreadIds?.[agentId];
    if (!agentThreadId) continue;
    const createdTime = Date.parse(record.createdAt);
    if (Number.isNaN(createdTime)) continue;
    if (createdTime > latestTime) {
      latestWithThreadId = record;
      latestTime = createdTime;
    }
  }

  return latestWithThreadId;
}

export async function findLatestJobByChannelThreadAndTypes(
  provider: 'slack' | 'discord',
  channelId: string,
  threadId: string,
  types: JobType[],
): Promise<JobRecord | undefined> {
  const records = await loadAllRecords();
  let latest: JobRecord | undefined;
  let latestTime = -1;

  for (const record of records) {
    const channel = record?.job?.channel;
    if (!channel || channel.provider !== provider) continue;
    if (channel.channelId !== channelId || channel.threadId !== threadId) continue;
    if (!types.includes(record.job.type)) continue;
    const createdTime = Date.parse(record.createdAt);
    if (Number.isNaN(createdTime)) continue;
    if (createdTime > latestTime) {
      latest = record;
      latestTime = createdTime;
    }
  }

  return latest;
}

export async function clearJobsBefore(cutoff: Date): Promise<number> {
  const ctx = await getDbContext();
  const cutoffTime = cutoff.getTime();
  if (Number.isNaN(cutoffTime)) {
    throw new Error('Invalid cutoff date.');
  }

  const keysToDelete: string[] = [];
  const records = await loadAllRecords();
  for (const record of records) {
    const key = jobKey(record.job.jobId);
    const createdAt = record?.createdAt;
    if (!createdAt) continue;
    const createdTime = Date.parse(createdAt);
    if (Number.isNaN(createdTime)) continue;
    if (createdTime < cutoffTime) {
      keysToDelete.push(key);
    }
  }

  if (!keysToDelete.length) {
    return 0;
  }

  if (ctx.kind === 'pg') {
    await ctx.client.db.delete(ctx.jobsTable).where(inArray(ctx.jobsTable.jobId, keysToDelete));
  } else {
    await ctx.client.db.delete(ctx.jobsTable).where(inArray(ctx.jobsTable.jobId, keysToDelete));
  }
  await Promise.all(keysToDelete.map((key) => removeJobRoot(jobIdFromKey(key))));
  return keysToDelete.length;
}

export async function clearJobsAfterMaxEntries(maxEntries: number): Promise<number> {
  const ctx = await getDbContext();
  const jobIdsToDelete = selectJobIdsBeyondMaxEntries(await loadAllRecords(), maxEntries);
  if (!jobIdsToDelete.length) {
    return 0;
  }
  const keysToDelete = jobIdsToDelete.map((jobId) => jobKey(jobId));
  if (ctx.kind === 'pg') {
    await ctx.client.db.delete(ctx.jobsTable).where(inArray(ctx.jobsTable.jobId, keysToDelete));
  } else {
    await ctx.client.db.delete(ctx.jobsTable).where(inArray(ctx.jobsTable.jobId, keysToDelete));
  }
  await Promise.all(jobIdsToDelete.map((jobId) => removeJobRoot(jobId)));
  return jobIdsToDelete.length;
}

async function runRetentionCleanup(): Promise<void> {
  let cleanupConfig;
  try {
    cleanupConfig = loadWorkerConfig();
  } catch (err) {
    logger.warn({ err }, 'Failed to load worker config for job retention cleanup');
    return;
  }
  const { cleanupMaxAge, cleanupMaxEntries } = cleanupConfig;
  if (!cleanupMaxAge && cleanupMaxEntries === undefined) {
    return;
  }
  if (cleanupMaxAge) {
    try {
      const durationMs = parseCleanupDurationMs(cleanupMaxAge);
      const cutoff = new Date(Date.now() - durationMs);
      await clearJobsBefore(cutoff);
    } catch (err) {
      logger.warn({ err, cleanupMaxAge }, 'Invalid cleanup_max_age; skipping age cleanup');
    }
  }
  if (cleanupMaxEntries !== undefined) {
    await clearJobsAfterMaxEntries(cleanupMaxEntries);
  }
}
