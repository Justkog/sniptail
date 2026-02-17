import { readFileSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { logger } from '../logger.js';
import type { RepoConfig } from '../types/job.js';

export function parseRepoAllowlist(filePath: string): Record<string, RepoConfig> {
  try {
    const raw = readFileSync(filePath, 'utf8');
    const parsed = JSON.parse(raw) as Record<string, RepoConfig>;
    if (!parsed || typeof parsed !== 'object') {
      throw new Error('Repo allowlist must be a JSON object.');
    }
    for (const [key, value] of Object.entries(parsed)) {
      if (!value || typeof value !== 'object') {
        throw new Error(`Repo allowlist entry invalid for ${key}.`);
      }
      if (value.provider !== undefined && typeof value.provider !== 'string') {
        throw new Error(`Repo allowlist entry provider invalid for ${key}.`);
      }
      if (
        value.providerData !== undefined &&
        (typeof value.providerData !== 'object' ||
          value.providerData === null ||
          Array.isArray(value.providerData))
      ) {
        throw new Error(`Repo allowlist entry providerData invalid for ${key}.`);
      }
      if (value.sshUrl !== undefined && typeof value.sshUrl !== 'string') {
        throw new Error(`Repo allowlist entry sshUrl invalid for ${key}.`);
      }
      if (value.localPath !== undefined && typeof value.localPath !== 'string') {
        throw new Error(`Repo allowlist entry localPath invalid for ${key}.`);
      }
      if (!value.sshUrl && !value.localPath) {
        throw new Error(`Repo allowlist entry missing sshUrl or localPath for ${key}.`);
      }
      if (value.baseBranch !== undefined && typeof value.baseBranch !== 'string') {
        throw new Error(`Repo allowlist entry baseBranch invalid for ${key}.`);
      }
    }
    return parsed;
  } catch (err) {
    logger.error({ err, filePath }, 'Failed to parse REPO_ALLOWLIST_PATH');
    throw err;
  }
}

export async function writeRepoAllowlist(
  filePath: string,
  allowlist: Record<string, RepoConfig>,
): Promise<void> {
  await writeFile(filePath, `${JSON.stringify(allowlist, null, 2)}\n`, 'utf8');
}
