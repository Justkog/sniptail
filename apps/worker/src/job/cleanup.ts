import { join } from 'node:path';
import { loadWorkerConfig } from '@sniptail/core/config/config.js';
import { deleteJobRecords, loadAllJobRecords } from '@sniptail/core/jobs/registry.js';
import { buildJobPaths } from '@sniptail/core/jobs/utils.js';
import { removeWorktree } from '@sniptail/core/git/worktree.js';
import { logger } from '@sniptail/core/logger.js';

function parseCleanupMaxAge(value: string): number | undefined {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  const match = /^(\d+)([dhm])$/i.exec(trimmed);
  if (!match) return undefined;
  const amount = Number.parseInt(match[1], 10);
  if (!Number.isFinite(amount) || amount < 0) return undefined;
  const unit = match[2].toLowerCase();
  const multiplier = unit === 'd' ? 86400000 : unit === 'h' ? 3600000 : 60000;
  return amount * multiplier;
}

async function removeJobRecords(
  recordsToDelete: Array<{ job: { jobId: string; repoKeys?: string[] } }>,
  config: ReturnType<typeof loadWorkerConfig>,
): Promise<void> {
  if (!recordsToDelete.length) return;
  for (const record of recordsToDelete) {
    const jobId = record.job.jobId;
    const paths = buildJobPaths(jobId);
    for (const repoKey of record.job.repoKeys ?? []) {
      const clonePath = join(config.repoCacheRoot, `${repoKey}.git`);
      const worktreePath = join(paths.reposRoot, repoKey);
      await removeWorktree({
        clonePath,
        worktreePath,
        logFilePath: paths.logFile,
        env: process.env,
      }).catch((err) => {
        logger.warn({ err, jobId, repoKey }, 'Failed to remove git worktree');
      });
    }
  }

  await deleteJobRecords(recordsToDelete.map((record) => record.job.jobId));
}

export async function enforceJobCleanup(): Promise<void> {
  const config = loadWorkerConfig();
  const maxEntries = config.cleanupMaxEntries;
  const maxAgeRaw = config.cleanupMaxAge;
  if (maxEntries === undefined && !maxAgeRaw) return;

  const maxAgeMs = maxAgeRaw ? parseCleanupMaxAge(maxAgeRaw) : undefined;
  if (maxAgeRaw && maxAgeMs === undefined) {
    logger.warn({ cleanupMaxAge: maxAgeRaw }, 'Invalid cleanup_max_age; skipping age-based cleanup');
  }

  const records = await loadAllJobRecords();
  const eligibleRecords = records.filter(
    (record) =>
      record.job.type === 'ASK' || record.job.type === 'PLAN' || record.job.type === 'IMPLEMENT',
  );
  if (!eligibleRecords.length) return;

  const enriched = eligibleRecords.map((record) => {
    const parsed = Date.parse(record.createdAt);
    return {
      record,
      createdAtMs: Number.isNaN(parsed) ? 0 : parsed,
    };
  });

  let remaining = enriched;
  if (maxAgeMs !== undefined) {
    const cutoff = Date.now() - maxAgeMs;
    const aged = remaining.filter((entry) => entry.createdAtMs <= cutoff);
    if (aged.length) {
      await removeJobRecords(aged.map(({ record }) => record), config);
      logger.info(
        { removed: aged.length, maxAge: maxAgeRaw, cutoff: new Date(cutoff).toISOString() },
        'Trimmed job history by max age',
      );
    }
    if (aged.length) {
      const agedIds = new Set(aged.map(({ record }) => record.job.jobId));
      remaining = remaining.filter(({ record }) => !agedIds.has(record.job.jobId));
    }
  }

  if (maxEntries === undefined) return;

  const normalizedMax = Math.max(0, maxEntries);
  if (remaining.length <= normalizedMax) return;

  const sorted = [...remaining].sort((a, b) => a.createdAtMs - b.createdAtMs);
  const excess = sorted.length - normalizedMax;
  if (excess <= 0) return;

  const recordsToDelete = sorted.slice(0, excess).map(({ record }) => record);
  if (!recordsToDelete.length) return;

  await removeJobRecords(recordsToDelete, config);
  logger.info(
    { removed: recordsToDelete.length, maxEntries: normalizedMax },
    'Trimmed job history to max entries',
  );
}
