import { mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { logger } from '@sniptail/core/logger.js';
import type { JobSpec } from '@sniptail/core/types/job.js';

export function createJobId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

const REQUEST_SUMMARY_MAX_LENGTH = 1000;

export function truncateRequestSummary(requestText: string): string {
  const trimmed = requestText.trim() || 'No request text provided.';
  if (trimmed.length <= REQUEST_SUMMARY_MAX_LENGTH) {
    return trimmed;
  }
  return `${trimmed.slice(0, REQUEST_SUMMARY_MAX_LENGTH)}…`;
}

export async function persistUploadSpec(job: JobSpec): Promise<string | null> {
  const artifactsRoot = join(tmpdir(), 'sniptail', job.jobId);
  const jobSpecPath = join(artifactsRoot, 'job-spec-upload.json');
  try {
    await mkdir(artifactsRoot, { recursive: true });
    const { contextFiles, ...jobSpec } = job;
    const sanitizedJobSpec = {
      ...jobSpec,
      requestText: undefined,
      threadContext: undefined,
    };
    const sanitizedContextFiles = contextFiles?.map((file) => ({
      originalName: file.originalName,
      mediaType: file.mediaType,
      byteSize: file.byteSize,
      source: file.source,
    }));
    await writeFile(
      jobSpecPath,
      `${JSON.stringify(
        {
          ...sanitizedJobSpec,
          ...(sanitizedContextFiles ? { contextFiles: sanitizedContextFiles } : {}),
        },
        null,
        2,
      )}\n`,
      'utf8',
    );
    return jobSpecPath;
  } catch (err) {
    logger.warn({ err, jobId: job.jobId }, 'Failed to write job spec upload artifact');
    return null;
  }
}
