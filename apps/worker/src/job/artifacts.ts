import { constants } from 'node:fs';
import { appendFile, copyFile, mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { buildJobPaths } from '@sniptail/core/jobs/utils.js';
import type { JobSpec } from '@sniptail/core/types/job.js';
import { logger } from '@sniptail/core/logger.js';
import { runCommand } from '@sniptail/core/runner/commandRunner.js';

type JobPaths = ReturnType<typeof buildJobPaths>;

export async function ensureJobDirectories(paths: JobPaths): Promise<void> {
  await mkdir(paths.reposRoot, { recursive: true });
  await mkdir(paths.artifactsRoot, { recursive: true });
  await mkdir(paths.logsRoot, { recursive: true });
}

export async function writeJobSpecArtifact(paths: JobPaths, job: JobSpec): Promise<void> {
  const jobSpecPath = join(paths.artifactsRoot, 'job-spec.json');
  await writeFile(jobSpecPath, `${JSON.stringify(job, null, 2)}\n`, 'utf8').catch((err) => {
    logger.warn({ err, jobId: job.jobId }, 'Failed to write job spec artifact');
  });
}

export async function readJobReport(paths: JobPaths): Promise<string> {
  const reportPath = join(paths.artifactsRoot, 'report.md');
  return readFile(reportPath, 'utf8');
}

export async function readJobPlan(paths: JobPaths): Promise<string> {
  const planPath = join(paths.artifactsRoot, 'plan.md');
  return readFile(planPath, 'utf8');
}

export async function readJobSummary(paths: JobPaths): Promise<string> {
  const summaryPath = join(paths.artifactsRoot, 'summary.md');
  return readFile(summaryPath, 'utf8');
}

export async function appendAgentEventLog(logFile: string, content: string): Promise<void> {
  await appendFile(logFile, content);
}

function isMissingPath(err: unknown): boolean {
  return (err as NodeJS.ErrnoException | undefined)?.code === 'ENOENT';
}

function isDestinationFilePresent(err: unknown): boolean {
  return (err as NodeJS.ErrnoException | undefined)?.code === 'EEXIST';
}

export async function copyArtifactsFromResumedJob(
  resumeFromJobId: string,
  paths: JobPaths,
): Promise<void> {
  const sourceArtifactsRoot = buildJobPaths(resumeFromJobId).artifactsRoot;
  const sourceEntries = await readdir(sourceArtifactsRoot, { withFileTypes: true }).catch((err) => {
    if (isMissingPath(err)) {
      return [];
    }
    throw err;
  });

  for (const sourceEntry of sourceEntries) {
    if (!sourceEntry.isFile()) continue;
    if (sourceEntry.name === 'job-spec.json') continue;
    const sourcePath = join(sourceArtifactsRoot, sourceEntry.name);
    const destinationPath = join(paths.artifactsRoot, sourceEntry.name);
    await copyFile(sourcePath, destinationPath, constants.COPYFILE_EXCL).catch((err) => {
      if (isDestinationFilePresent(err)) {
        return;
      }
      throw err;
    });
  }
}

export async function copyJobRootSeed(
  jobRootCopyGlob: string | undefined,
  jobRootPath: string,
  env: NodeJS.ProcessEnv,
  logFile: string,
  redact: Array<string | RegExp>,
): Promise<void> {
  const trimmed = jobRootCopyGlob?.trim();
  if (!trimmed) return;
  const script = [
    'set -euo pipefail',
    'shopt -s nullglob',
    'matches=( $JOB_ROOT_COPY_GLOB )',
    'if (( ${#matches[@]} == 0 )); then',
    '  echo "No matches for JOB_ROOT_COPY_GLOB=$JOB_ROOT_COPY_GLOB"',
    '  exit 0',
    'fi',
    'for match in "${matches[@]}"; do',
    '  if [[ -d "$match" ]]; then',
    '    cp -R -- "$match/." "$JOB_ROOT_DEST"/',
    '  else',
    '    cp -R -- "$match" "$JOB_ROOT_DEST"/',
    '  fi',
    'done',
  ].join('\n');

  await runCommand('bash', ['-lc', script], {
    cwd: jobRootPath,
    env: { ...env, JOB_ROOT_COPY_GLOB: trimmed, JOB_ROOT_DEST: jobRootPath },
    logFilePath: logFile,
    timeoutMs: 60_000,
    redact,
  });
}
