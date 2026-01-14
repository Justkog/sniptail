import { mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { ClassicLevel } from 'classic-level';
import { config } from '../config/index.js';
import { logger } from '../logger.js';
import type { JobSpec, MergeRequestResult } from '../types/job.js';

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

const levelDb = new ClassicLevel<string, JobRecord>(config.jobRegistryPath, { valueEncoding: 'json' });

let dbReady: Promise<void> | null = null;

async function ensureDbReady() {
  if (!dbReady) {
    dbReady = mkdir(config.jobRegistryPath, { recursive: true }).then(() => levelDb.open());
  }
  await dbReady;
}

function jobKey(jobId: string) {
  return `job:${jobId}`;
}

levelDb.on('write', (ops: Array<{ type?: string; key?: unknown }>) => {
  for (const op of ops) {
    if (op?.type !== 'del' || typeof op.key !== 'string') continue;
    if (!op.key.startsWith('job:')) continue;
    const jobId = op.key.slice('job:'.length);
    const jobRoot = join(config.jobWorkRoot, jobId);
    rm(jobRoot, { recursive: true, force: true })
      .then(() => {
        logger.info({ jobId, jobRoot }, 'Cleared expired job data');
      })
      .catch((err) => {
        logger.warn({ err, jobId, jobRoot }, 'Failed to clear expired job data');
      });
  }
});

export async function loadJobRecord(jobId: string): Promise<JobRecord | undefined> {
  await ensureDbReady();
  try {
    return await levelDb.get(jobKey(jobId));
  } catch (err) {
    const error = err as { code?: string; notFound?: boolean };
    if (error?.code === 'LEVEL_NOT_FOUND' || error?.notFound) {
      return undefined;
    }
    throw err;
  }
}

export async function saveJobQueued(job: JobSpec): Promise<JobRecord> {
  await ensureDbReady();
  const now = new Date().toISOString();
  const record: JobRecord = {
    job,
    status: 'queued',
    createdAt: now,
    updatedAt: now,
  };
  await levelDb.put(jobKey(job.jobId), record);
  return record;
}

export async function updateJobRecord(jobId: string, patch: Partial<JobRecord>): Promise<JobRecord> {
  await ensureDbReady();
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
  await levelDb.put(jobKey(jobId), updated);
  return updated;
}

export async function markJobForDeletion(jobId: string, ttlMs: number): Promise<JobRecord> {
  await ensureDbReady();
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
  await levelDb.put(key, updated);
  setTimeout(() => {
    levelDb
      .del(key)
      .catch((err) => logger.warn({ err, jobId }, 'Failed to delete expired job record'));
  }, ttlMs);
  return updated;
}

export async function findLatestJobBySlackThread(
  channelId: string,
  threadTs: string,
): Promise<JobRecord | undefined> {
  await ensureDbReady();
  let latestWithThreadId: JobRecord | undefined;
  let latestTime = -1;

  for await (const [, record] of levelDb.iterator({ gte: 'job:', lt: 'job;' })) {
    const slack = record?.job?.slack;
    if (!slack || slack.channelId !== channelId || slack.threadTs !== threadTs) continue;
    if (!record.job?.codexThreadId) continue;
    const createdTime = Date.parse(record.createdAt);
    if (Number.isNaN(createdTime)) continue;
    if (createdTime > latestTime) {
      latestWithThreadId = record;
      latestTime = createdTime;
    }
  }

  return latestWithThreadId;
}

export async function clearJobsBefore(cutoff: Date): Promise<number> {
  await ensureDbReady();
  const cutoffTime = cutoff.getTime();
  if (Number.isNaN(cutoffTime)) {
    throw new Error('Invalid cutoff date.');
  }

  const keysToDelete: string[] = [];
  for await (const [key, record] of levelDb.iterator({ gte: 'job:', lt: 'job;' })) {
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

  const batch = levelDb.batch();
  for (const key of keysToDelete) {
    batch.del(key);
  }
  await batch.write();
  return keysToDelete.length;
}
