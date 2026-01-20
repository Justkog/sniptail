import { mkdir, rm, stat } from 'node:fs/promises';
import { dirname, extname, join } from 'node:path';
import Database, { type Statement } from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { loadCoreConfig } from '../config/index.js';
import { logger } from '../logger.js';
import type { JobSpec, JobType, MergeRequestResult } from '../types/job.js';

const config = loadCoreConfig();

const JOB_KEY_PREFIX = 'job:';
const JOB_REGISTRY_FILENAME = 'job-registry.sqlite';
const SQLITE_BUSY_TIMEOUT_MS = 5000;

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

let dbReady: Promise<void> | null = null;
let sqliteDb: Database.Database | null = null;
let dbFilePath: string | null = null;
let statements: {
  getJob: Statement<{ jobId: string }>;
  getAll: Statement<{ prefix: string }>;
  putJob: Statement<{ jobId: string; record: string }>;
  deleteJob: Statement<{ jobId: string }>;
} | null = null;

function getSqliteDb(): Database.Database {
  if (!sqliteDb) {
    throw new Error('Job registry database is not initialized.');
  }
  return sqliteDb;
}

function getStatements() {
  if (!statements) {
    throw new Error('Job registry statements are not initialized.');
  }
  return statements;
}

async function resolveDbFilePath(): Promise<string> {
  const configured = config.jobRegistryPath;
  if (configured.endsWith('/')) {
    return join(configured, JOB_REGISTRY_FILENAME);
  }
  try {
    const stats = await stat(configured);
    if (stats.isDirectory()) {
      return join(configured, JOB_REGISTRY_FILENAME);
    }
    return configured;
  } catch {
    const ext = extname(configured).toLowerCase();
    if (ext === '.db' || ext === '.sqlite' || ext === '.sqlite3') {
      return configured;
    }
    return join(configured, JOB_REGISTRY_FILENAME);
  }
}

async function ensureDbReady() {
  if (!dbReady) {
    dbReady = (async () => {
      dbFilePath = await resolveDbFilePath();
      await mkdir(dirname(dbFilePath), { recursive: true });
      const sqlite = new Database(dbFilePath);
      sqlite.pragma('journal_mode = WAL');
      sqlite.pragma(`busy_timeout = ${SQLITE_BUSY_TIMEOUT_MS}`);
      const drizzleDb = drizzle({ client: sqlite });
      drizzleDb.run(
        `CREATE TABLE IF NOT EXISTS jobs (jobId TEXT PRIMARY KEY, record TEXT NOT NULL)`,
      );
      sqliteDb = sqlite;
      statements = {
        getJob: sqlite.prepare('SELECT record FROM jobs WHERE jobId = @jobId'),
        getAll: sqlite.prepare('SELECT record FROM jobs WHERE jobId LIKE @prefix'),
        putJob: sqlite.prepare(
          'INSERT INTO jobs (jobId, record) VALUES (@jobId, @record) ' +
            'ON CONFLICT(jobId) DO UPDATE SET record = excluded.record',
        ),
        deleteJob: sqlite.prepare('DELETE FROM jobs WHERE jobId = @jobId'),
      };
    })();
  }
  await dbReady;
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

function parseRecord(row?: { record: string } | null): JobRecord | undefined {
  if (!row?.record) return undefined;
  try {
    return JSON.parse(row.record) as JobRecord;
  } catch (err) {
    logger.warn({ err, dbFilePath }, 'Failed to parse job record JSON');
    return undefined;
  }
}

export async function loadJobRecord(jobId: string): Promise<JobRecord | undefined> {
  await ensureDbReady();
  const row = getStatements().getJob.get({ jobId: jobKey(jobId) }) as
    | { record: string }
    | undefined;
  return parseRecord(row);
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
  getStatements().putJob.run({ jobId: jobKey(job.jobId), record: JSON.stringify(record) });
  return record;
}

export async function updateJobRecord(
  jobId: string,
  patch: Partial<JobRecord>,
): Promise<JobRecord> {
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
  getStatements().putJob.run({ jobId: jobKey(jobId), record: JSON.stringify(updated) });
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
  getStatements().putJob.run({ jobId: key, record: JSON.stringify(updated) });
  setTimeout(() => {
    ensureDbReady()
      .then(() => {
        getStatements().deleteJob.run({ jobId: key });
        return removeJobRoot(jobId);
      })
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

  const rows = getStatements().getAll.all({ prefix: `${JOB_KEY_PREFIX}%` }) as
    | { record: string }[]
    | undefined;
  for (const row of rows ?? []) {
    const record = parseRecord(row);
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

export async function findLatestJobBySlackThreadAndTypes(
  channelId: string,
  threadTs: string,
  types: JobType[],
): Promise<JobRecord | undefined> {
  await ensureDbReady();
  let latest: JobRecord | undefined;
  let latestTime = -1;

  const rows = getStatements().getAll.all({ prefix: `${JOB_KEY_PREFIX}%` }) as
    | { record: string }[]
    | undefined;
  for (const row of rows ?? []) {
    const record = parseRecord(row);
    const slack = record?.job?.slack;
    if (!slack || slack.channelId !== channelId || slack.threadTs !== threadTs) continue;
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
  await ensureDbReady();
  const cutoffTime = cutoff.getTime();
  if (Number.isNaN(cutoffTime)) {
    throw new Error('Invalid cutoff date.');
  }

  const keysToDelete: string[] = [];
  const rows = getStatements().getAll.all({ prefix: `${JOB_KEY_PREFIX}%` }) as
    | { record: string }[]
    | undefined;
  for (const row of rows ?? []) {
    const record = parseRecord(row);
    if (!record) continue;
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

  const sqlite = getSqliteDb();
  sqlite.transaction(() => {
    for (const key of keysToDelete) {
      getStatements().deleteJob.run({ jobId: key });
    }
  })();
  await Promise.all(keysToDelete.map((key) => removeJobRoot(jobIdFromKey(key))));
  return keysToDelete.length;
}
