import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ReleaseInfo } from './releaseInfo.js';

export function normalizeReleaseVersion(version: string): string {
  const normalized = version.trim().replace(/^v/, '');
  if (!normalized) throw new Error('Release version must not be empty.');
  return normalized;
}

export function normalizeReleaseCommit(commit: string): string {
  const normalized = commit.trim();
  if (!/^[0-9a-f]{7,}$/i.test(normalized)) {
    throw new Error('Release commit must contain at least seven hexadecimal characters.');
  }
  return normalized.slice(0, 7).toLowerCase();
}

export function createReleaseInfo(
  version: string,
  commit: string,
  buildDate = new Date().toISOString(),
): ReleaseInfo {
  if (!Number.isFinite(Date.parse(buildDate)) || new Date(buildDate).toISOString() !== buildDate) {
    throw new Error('Release build date must be an ISO timestamp.');
  }

  return {
    name: 'sniptail',
    version: normalizeReleaseVersion(version),
    commit: normalizeReleaseCommit(commit),
    buildDate,
  };
}

export function writeReleaseInfo(
  outputPath: string,
  version: string,
  commit: string,
  buildDate?: string,
): ReleaseInfo {
  const releaseInfo = createReleaseInfo(version, commit, buildDate);
  writeFileSync(outputPath, `${JSON.stringify(releaseInfo, null, 2)}\n`, 'utf8');
  return releaseInfo;
}

function main(): void {
  const [outputPath, version, commit] = process.argv.slice(2);
  if (!outputPath || !version || !commit) {
    throw new Error('Usage: releaseInfoWriter <output-path> <version> <commit>');
  }
  writeReleaseInfo(outputPath, version, commit);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
