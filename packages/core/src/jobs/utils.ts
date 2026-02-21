import { join } from 'node:path';
import type { JobSpec, RepoConfig } from '../types/job.js';

const gitRefPattern = /^[A-Za-z0-9._/-]+$/;

export function validateJob(job: JobSpec, repoAllowlist: Record<string, RepoConfig> = {}) {
  if (job.type !== 'MENTION' && job.repoKeys.length === 0) {
    throw new Error('Job must include at least one repo.');
  }
  if (job.type !== 'MENTION') {
    for (const repoKey of job.repoKeys) {
      if (!repoAllowlist[repoKey]) {
        throw new Error(`Repo ${repoKey} is not in allowlist.`);
      }
    }
    if (!gitRefPattern.test(job.gitRef)) {
      throw new Error(`Invalid git ref: ${job.gitRef}`);
    }
  }
}

export function buildJobPaths(jobWorkRoot: string, jobId: string) {
  const root = join(jobWorkRoot, jobId);
  return {
    root,
    reposRoot: join(root, 'repos'),
    artifactsRoot: join(root, 'artifacts'),
    logsRoot: join(root, 'logs'),
    logFile: join(root, 'logs', 'runner.log'),
  };
}

export function parseReviewerIds(values?: string[]): number[] | undefined {
  if (!values) return undefined;
  const ids = values
    .map((value) => Number.parseInt(value, 10))
    .filter((value) => Number.isFinite(value));
  return ids.length ? ids : undefined;
}
