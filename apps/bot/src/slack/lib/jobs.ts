import { mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { BotConfig } from '@sniptail/core/config/config.js';
import { logger } from '@sniptail/core/logger.js';
import type { JobSpec } from '@sniptail/core/types/job.js';

export function createJobId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export async function persistJobSpec(config: BotConfig, job: JobSpec): Promise<string | null> {
  const jobRoot = join(config.jobWorkRoot, job.jobId);
  const artifactsRoot = join(jobRoot, 'artifacts');
  const jobSpecPath = join(artifactsRoot, 'job-spec.json');
  try {
    await mkdir(artifactsRoot, { recursive: true });
    await writeFile(jobSpecPath, `${JSON.stringify(job, null, 2)}\n`, 'utf8');
    return jobSpecPath;
  } catch (err) {
    logger.warn({ err, jobId: job.jobId }, 'Failed to write job spec artifact');
    return null;
  }
}

export async function persistSlackUploadSpec(job: JobSpec): Promise<string | null> {
  const artifactsRoot = join(tmpdir(), 'sniptail', job.jobId);
  const jobSpecPath = join(artifactsRoot, 'job-spec-upload.json');
  try {
    await mkdir(artifactsRoot, { recursive: true });
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { requestText: _requestText, slackThreadContext: _slackThreadContext, ...jobSpec } = job;
    await writeFile(jobSpecPath, `${JSON.stringify(jobSpec, null, 2)}\n`, 'utf8');
    return jobSpecPath;
  } catch (err) {
    logger.warn({ err, jobId: job.jobId }, 'Failed to write job spec upload artifact');
    return null;
  }
}
