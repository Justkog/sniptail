import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { loadCoreConfig } from '../config/config.js';
import { logger } from '../logger.js';
import type { ChannelProvider } from '../types/channel.js';
import type { AgentId, JobSpec, JobType } from '../types/job.js';
import { getJobRegistryStore } from './registryStore.js';
import type { JobRecord } from './registryTypes.js';

export type { JobRecord, JobStatus } from './registryTypes.js';

const JOB_KEY_PREFIX = 'job:';

function jobKey(jobId: string) {
  return `${JOB_KEY_PREFIX}${jobId}`;
}

function jobIdFromKey(key: string) {
  return key.startsWith(JOB_KEY_PREFIX) ? key.slice(JOB_KEY_PREFIX.length) : key;
}

function removeJobRoot(jobId: string) {
  const { jobWorkRoot } = loadCoreConfig();
  if (!jobWorkRoot) {
    return Promise.resolve();
  }
  const jobRoot = join(jobWorkRoot, jobId);
  return rm(jobRoot, { recursive: true, force: true })
    .then(() => {
      logger.info({ jobId, jobRoot }, 'Cleared expired job data');
    })
    .catch((err) => {
      logger.warn({ err, jobId, jobRoot }, 'Failed to clear expired job data');
    });
}

async function loadAllRecords(): Promise<JobRecord[]> {
  const store = await getJobRegistryStore();
  return store.loadAllRecordsByPrefix(JOB_KEY_PREFIX);
}

export async function loadJobRecord(jobId: string): Promise<JobRecord | undefined> {
  const store = await getJobRegistryStore();
  return store.loadRecordByKey(jobKey(jobId));
}

export async function saveJobQueued(job: JobSpec): Promise<JobRecord> {
  const store = await getJobRegistryStore();
  const now = new Date().toISOString();
  const record: JobRecord = {
    job,
    status: 'queued',
    createdAt: now,
    updatedAt: now,
  };
  await store.upsertRecord(jobKey(job.jobId), record);
  return record;
}

export async function loadAllJobRecords(): Promise<JobRecord[]> {
  return loadAllRecords();
}

export async function deleteJobRecords(jobIds: string[]): Promise<void> {
  if (!jobIds.length) return;
  const store = await getJobRegistryStore();
  const keysToDelete = jobIds.map((jobId) => jobKey(jobId));
  await store.deleteRecordsByKeys(keysToDelete);
  await Promise.all(jobIds.map((jobId) => removeJobRoot(jobId)));
}

export async function updateJobRecord(
  jobId: string,
  patch: Partial<JobRecord>,
): Promise<JobRecord> {
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
  const store = await getJobRegistryStore();
  await store.upsertRecord(jobKey(jobId), updated);
  return updated;
}

export async function markJobForDeletion(jobId: string, ttlMs: number): Promise<JobRecord> {
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
  const store = await getJobRegistryStore();
  await store.upsertRecord(key, updated);

  setTimeout(() => {
    getJobRegistryStore()
      .then(async (timerStore) => {
        await timerStore.deleteRecordByKey(key);
        await removeJobRoot(jobId);
      })
      .catch((err) => logger.warn({ err, jobId }, 'Failed to delete expired job record'));
  }, ttlMs);

  return updated;
}

export async function findLatestJobByChannelThread(
  provider: ChannelProvider,
  channelId: string,
  threadId: string,
  agentId: AgentId,
): Promise<JobRecord | undefined> {
  const store = await getJobRegistryStore();
  return store.findLatestJobRecordByChannelThread({
    provider,
    channelId,
    threadId,
    agentId,
  });
}

export async function findLatestJobByChannelThreadAndTypes(
  provider: ChannelProvider,
  channelId: string,
  threadId: string,
  types: JobType[],
): Promise<JobRecord | undefined> {
  const store = await getJobRegistryStore();
  return store.findLatestJobRecordByChannelThread({
    provider,
    channelId,
    threadId,
    types,
  });
}

export async function clearJobsBefore(cutoff: Date): Promise<number> {
  const cutoffTime = cutoff.getTime();
  if (Number.isNaN(cutoffTime)) {
    throw new Error('Invalid cutoff date.');
  }

  const store = await getJobRegistryStore();
  const keysToDelete = await store.listJobKeysCreatedBefore(cutoff.toISOString());

  if (!keysToDelete.length) {
    return 0;
  }

  await store.deleteRecordsByKeys(keysToDelete);
  await Promise.all(keysToDelete.map((key) => removeJobRoot(jobIdFromKey(key))));
  return keysToDelete.length;
}

export async function countJobRecordsByTypes(types: JobType[]): Promise<number> {
  const store = await getJobRegistryStore();
  return store.countJobRecordsByTypes(types);
}

export async function listJobRecordsForCleanup(input: {
  types: JobType[];
  olderThan?: string;
  limit?: number;
}): Promise<JobRecord[]> {
  const store = await getJobRegistryStore();
  return store.listJobRecordsForCleanup(input);
}
