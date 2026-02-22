import { join } from 'node:path';
import { readdir } from 'node:fs/promises';
import { loadWorkerConfig } from '@sniptail/core/config/config.js';
import { ensureClone } from '@sniptail/core/git/mirror.js';
import { logger } from '@sniptail/core/logger.js';
import { listRepoCatalogEntries, upsertRepoCatalogEntry } from '@sniptail/core/repos/catalog.js';
import type { RepoRow } from '@sniptail/core/repos/catalogTypes.js';
import {
  normalizeRunActionId,
  withRepoRunActionsMetadata,
} from '@sniptail/core/repos/runActions.js';
import type { RepoConfig } from '@sniptail/core/types/job.js';

const RUN_CONTRACTS_DIR = '.sniptail/run';

type RepoSyncFailure = {
  repoKey: string;
  message: string;
};

export type RunActionMetadataSyncResult = {
  scanned: number;
  updated: number;
  failures: RepoSyncFailure[];
};

function toRepoConfig(row: RepoRow): RepoConfig {
  return {
    provider: row.provider,
    ...(row.providerData ? { providerData: row.providerData } : {}),
    ...(row.sshUrl ? { sshUrl: row.sshUrl } : {}),
    ...(row.localPath ? { localPath: row.localPath } : {}),
    ...(row.projectId !== undefined ? { projectId: row.projectId } : {}),
    ...(row.baseBranch ? { baseBranch: row.baseBranch } : {}),
  };
}

async function listRunActionIdsFromRepoPath(repoPath: string): Promise<string[]> {
  const directoryPath = join(repoPath, RUN_CONTRACTS_DIR);
  const entries = await readdir(directoryPath, { withFileTypes: true }).catch((err) => {
    if ((err as NodeJS.ErrnoException | undefined)?.code === 'ENOENT') {
      return [];
    }
    throw err;
  });

  const ids = new Set<string>();
  for (const entry of entries) {
    if (!entry.isFile() && !entry.isSymbolicLink()) {
      continue;
    }
    try {
      ids.add(normalizeRunActionId(entry.name));
    } catch {
      logger.warn(
        { entryName: entry.name, directoryPath },
        'Skipping invalid run action id discovered from repository contracts',
      );
    }
  }

  return Array.from(ids).sort((a, b) => a.localeCompare(b));
}

async function resolveRepoInspectionPath(
  row: RepoRow,
  repoConfig: RepoConfig,
  logFilePath: string,
): Promise<string> {
  if (row.localPath) {
    return row.localPath;
  }

  const config = loadWorkerConfig();
  const clonePath = join(config.repoCacheRoot, `${row.repoKey}.git`);
  const baseBranch = row.baseBranch?.trim() || 'main';
  await ensureClone(row.repoKey, repoConfig, clonePath, logFilePath, process.env, baseBranch, []);
  return clonePath;
}

async function syncRepoRunActionsRow(
  row: RepoRow,
  logFilePath: string,
): Promise<{ updated: boolean }> {
  const repoConfig = toRepoConfig(row);
  const inspectionPath = await resolveRepoInspectionPath(row, repoConfig, logFilePath);
  const actionIds = await listRunActionIdsFromRepoPath(inspectionPath);
  const syncedAt = new Date().toISOString();

  const providerData = withRepoRunActionsMetadata(repoConfig.providerData, {
    actionIds,
    syncedAt,
    sourceRef: row.baseBranch,
  });

  await upsertRepoCatalogEntry(
    row.repoKey,
    {
      ...repoConfig,
      providerData,
    },
    {
      provider: row.provider,
      isActive: row.isActive,
    },
  );

  return { updated: true };
}

export async function syncRunActionMetadata(
  options: {
    repoKey?: string;
    logFilePath?: string;
  } = {},
): Promise<RunActionMetadataSyncResult> {
  const config = loadWorkerConfig();
  const logFilePath =
    options.logFilePath ?? join(config.jobWorkRoot, 'logs', 'run-action-metadata-sync.log');

  const rows = await listRepoCatalogEntries();
  const targetRows = options.repoKey ? rows.filter((row) => row.repoKey === options.repoKey) : rows;

  if (options.repoKey && targetRows.length === 0) {
    throw new Error(`Repository key "${options.repoKey}" not found in the active catalog.`);
  }

  let updated = 0;
  const failures: RepoSyncFailure[] = [];

  for (const row of targetRows) {
    try {
      await syncRepoRunActionsRow(row, logFilePath);
      updated += 1;
    } catch (err) {
      const message = (err as Error).message;
      failures.push({ repoKey: row.repoKey, message });
      logger.warn(
        { err, repoKey: row.repoKey },
        'Failed to sync run action metadata for repository',
      );
    }
  }

  return {
    scanned: targetRows.length,
    updated,
    failures,
  };
}
