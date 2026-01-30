import { join } from 'node:path';
import { loadWorkerConfig } from '@sniptail/core/config/config.js';
import { deleteJobRecords, loadAllJobRecords } from '@sniptail/core/jobs/registry.js';
import { buildJobPaths } from '@sniptail/core/jobs/utils.js';
import { removeWorktree } from '@sniptail/core/git/worktree.js';
import { logger } from '@sniptail/core/logger.js';

export async function enforceCleanupMaxEntries(): Promise<void> {
  const config = loadWorkerConfig();
  const maxEntries = config.cleanupMaxEntries;
  if (maxEntries === undefined) return;

  const normalizedMax = Math.max(0, maxEntries);
  const records = await loadAllJobRecords();
  const eligibleRecords = records.filter(
    (record) =>
      record.job.type === 'ASK' || record.job.type === 'PLAN' || record.job.type === 'IMPLEMENT',
  );
  if (eligibleRecords.length <= normalizedMax) return;

  const sorted = eligibleRecords
    .map((record) => {
      const parsed = Date.parse(record.createdAt);
      return {
        record,
        createdAtMs: Number.isNaN(parsed) ? 0 : parsed,
      };
    })
    .sort((a, b) => a.createdAtMs - b.createdAtMs);

  const excess = sorted.length - normalizedMax;
  if (excess <= 0) return;

  const recordsToDelete = sorted.slice(0, excess).map(({ record }) => record);
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
  logger.info(
    { removed: recordsToDelete.length, maxEntries: normalizedMax },
    'Trimmed job history to max entries',
  );
}
