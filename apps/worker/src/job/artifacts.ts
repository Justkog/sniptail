import { constants } from 'node:fs';
import { appendFile, copyFile, mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { join, parse } from 'node:path';
import { buildJobPaths } from '@sniptail/core/jobs/utils.js';
import type { JobContextFileSource, JobSpec } from '@sniptail/core/types/job.js';
import { logger } from '@sniptail/core/logger.js';
import { runCommand } from '@sniptail/core/runner/commandRunner.js';

type JobPaths = ReturnType<typeof buildJobPaths>;

export type MaterializedJobContextFile = {
  path: string;
  storedName: string;
  originalName: string;
  mediaType: string;
  byteSize: number;
  source?: JobContextFileSource;
  validationNotes?: string[];
};

type JobContextManifest = {
  version: 1;
  generatedAt: string;
  files: MaterializedJobContextFile[];
};

const contextManifestFileName = 'manifest.json';

export async function ensureJobDirectories(paths: JobPaths): Promise<void> {
  await mkdir(paths.reposRoot, { recursive: true });
  await mkdir(paths.contextRoot, { recursive: true });
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

export async function readJobArtifact(paths: JobPaths, fileName: string): Promise<string> {
  return readFile(join(paths.artifactsRoot, fileName), 'utf8');
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

function sanitizeContextFileSegment(value: string): string {
  return value
    .trim()
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '')
    .slice(0, 80);
}

function buildStoredContextFileName(originalName: string, usedNames: Set<string>): string {
  const parsed = parse(originalName);
  const baseName = sanitizeContextFileSegment(parsed.name) || 'file';
  const extension = parsed.ext.replace(/[^.A-Za-z0-9_-]+/g, '').slice(0, 20);

  let suffix = 0;
  while (true) {
    const candidate = `${baseName}${suffix ? `-${suffix}` : ''}${extension}`;
    if (!usedNames.has(candidate) && candidate !== contextManifestFileName) {
      usedNames.add(candidate);
      return candidate;
    }
    suffix += 1;
  }
}

async function loadExistingContextManifest(paths: JobPaths): Promise<MaterializedJobContextFile[]> {
  const manifestPath = join(paths.contextRoot, contextManifestFileName);
  const currentFiles = new Set(
    (
      await readdir(paths.contextRoot, { withFileTypes: true }).catch((err) => {
        if (isMissingPath(err)) {
          return [];
        }
        throw err;
      })
    )
      .filter((entry) => entry.isFile())
      .map((entry) => entry.name),
  );

  try {
    const raw = await readFile(manifestPath, 'utf8');
    const parsed = JSON.parse(raw) as { files?: MaterializedJobContextFile[] };
    if (!Array.isArray(parsed.files)) {
      return [];
    }
    return parsed.files.filter((entry) => currentFiles.has(entry.storedName));
  } catch (err) {
    if (isMissingPath(err)) {
      return [];
    }
    logger.warn({ err, manifestPath }, 'Failed to read existing context manifest');
    return [];
  }
}

async function writeContextManifest(
  paths: JobPaths,
  entries: MaterializedJobContextFile[],
): Promise<void> {
  const manifestPath = join(paths.contextRoot, contextManifestFileName);
  const manifest: JobContextManifest = {
    version: 1,
    generatedAt: new Date().toISOString(),
    files: entries,
  };
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
}

export async function copyArtifactsFromResumedJob(
  resumeFromJobId: string,
  jobWorkRoot: string,
  paths: JobPaths,
): Promise<void> {
  const sourceArtifactsRoot = buildJobPaths(jobWorkRoot, resumeFromJobId).artifactsRoot;
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

export async function copyContextFromResumedJob(
  resumeFromJobId: string,
  jobWorkRoot: string,
  paths: JobPaths,
): Promise<void> {
  const sourceContextRoot = buildJobPaths(jobWorkRoot, resumeFromJobId).contextRoot;
  const sourceEntries = await readdir(sourceContextRoot, { withFileTypes: true }).catch((err) => {
    if (isMissingPath(err)) {
      return [];
    }
    throw err;
  });

  for (const sourceEntry of sourceEntries) {
    if (!sourceEntry.isFile()) continue;
    const sourcePath = join(sourceContextRoot, sourceEntry.name);
    const destinationPath = join(paths.contextRoot, sourceEntry.name);
    await copyFile(sourcePath, destinationPath, constants.COPYFILE_EXCL).catch((err) => {
      if (isDestinationFilePresent(err)) {
        return;
      }
      throw err;
    });
  }
}

export async function materializeJobContextFiles(
  paths: JobPaths,
  job: JobSpec,
): Promise<MaterializedJobContextFile[]> {
  const existingEntries = await loadExistingContextManifest(paths);
  const usedNames = new Set(existingEntries.map((entry) => entry.storedName));
  const newEntries: MaterializedJobContextFile[] = [];

  for (const contextFile of job.contextFiles ?? []) {
    const storedName = buildStoredContextFileName(contextFile.originalName, usedNames);
    const outputPath = join(paths.contextRoot, storedName);
    const fileContent = Buffer.from(contextFile.contentBase64, 'base64');
    const validationNotes =
      fileContent.byteLength !== contextFile.byteSize
        ? [`Normalized byte size from ${contextFile.byteSize} to ${fileContent.byteLength}.`]
        : undefined;

    await writeFile(outputPath, fileContent);
    newEntries.push({
      path: `context/${storedName}`,
      storedName,
      originalName: contextFile.originalName,
      mediaType: contextFile.mediaType,
      byteSize: fileContent.byteLength,
      ...(contextFile.source ? { source: contextFile.source } : {}),
      ...(validationNotes ? { validationNotes } : {}),
    });
  }

  await writeContextManifest(paths, [...existingEntries, ...newEntries]);
  return newEntries;
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
