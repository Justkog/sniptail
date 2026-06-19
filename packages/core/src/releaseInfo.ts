import { readFileSync } from 'node:fs';
import { dirname, join, parse } from 'node:path';
import { fileURLToPath } from 'node:url';

export type ReleaseInfo = {
  name: string;
  version: string;
  commit: string;
  buildDate: string;
};

const DEFAULT_RELEASE_INFO_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  'release-info.json',
);

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isIsoDate(value: string): boolean {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString() === value;
}

export function parseReleaseInfo(value: unknown): ReleaseInfo | undefined {
  if (typeof value !== 'object' || value === null) return undefined;

  const candidate = value as Record<string, unknown>;
  if (
    !isNonEmptyString(candidate.name) ||
    !isNonEmptyString(candidate.version) ||
    !isNonEmptyString(candidate.commit) ||
    !isNonEmptyString(candidate.buildDate) ||
    !isIsoDate(candidate.buildDate)
  ) {
    return undefined;
  }

  return {
    name: candidate.name,
    version: candidate.version,
    commit: candidate.commit,
    buildDate: candidate.buildDate,
  };
}

export function readReleaseInfo(path = DEFAULT_RELEASE_INFO_PATH): ReleaseInfo | undefined {
  try {
    return parseReleaseInfo(JSON.parse(readFileSync(path, 'utf8')) as unknown);
  } catch {
    return undefined;
  }
}

function readPackageVersion(path: string): string | undefined {
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as { version?: unknown };
    return isNonEmptyString(parsed.version) ? parsed.version : undefined;
  } catch {
    return undefined;
  }
}

function findNearestPackageVersion(callerUrl: string): string | undefined {
  let currentDirectory: string;
  try {
    currentDirectory = dirname(fileURLToPath(callerUrl));
  } catch {
    return undefined;
  }

  const root = parse(currentDirectory).root;
  while (true) {
    const version = readPackageVersion(join(currentDirectory, 'package.json'));
    if (version) return version;
    if (currentDirectory === root) return undefined;
    currentDirectory = dirname(currentDirectory);
  }
}

export function resolveSniptailVersion(
  callerUrl: string,
  releaseInfoPath = DEFAULT_RELEASE_INFO_PATH,
): string {
  const environmentVersion = process.env.SNIPTAIL_VERSION?.trim();
  if (environmentVersion) return environmentVersion;

  const releaseInfo = readReleaseInfo(releaseInfoPath);
  if (releaseInfo) return releaseInfo.version;

  return findNearestPackageVersion(callerUrl) ?? 'unknown';
}
