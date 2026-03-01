import { join } from 'node:path';
import { readdir, readFile } from 'node:fs/promises';
import { loadWorkerConfig } from '@sniptail/core/config/config.js';
import { parseTomlTable } from '@sniptail/core/config/toml.js';
import { ensureClone } from '@sniptail/core/git/mirror.js';
import { logger } from '@sniptail/core/logger.js';
import { listRepoCatalogEntries, upsertRepoCatalogEntry } from '@sniptail/core/repos/catalog.js';
import { parseRunActionSidecarTable } from '@sniptail/core/repos/runActionSidecarSchema.js';
import type { RepoRow } from '@sniptail/core/repos/catalogTypes.js';
import {
  normalizeRunActionId,
  type RepoRunActionMetadata,
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

async function parseRunActionSidecar(filePath: string): Promise<RepoRunActionMetadata> {
  const raw = await readFile(filePath, 'utf8');
  const table = parseTomlTable(raw, `run params sidecar ${filePath}`);
  return parseRunActionSidecarTable(table, filePath);
}

async function listRunActionsFromRepoPath(
  repoPath: string,
): Promise<Record<string, RepoRunActionMetadata>> {
  const directoryPath = join(repoPath, RUN_CONTRACTS_DIR);
  const entries = await readdir(directoryPath, { withFileTypes: true }).catch((err) => {
    if ((err as NodeJS.ErrnoException | undefined)?.code === 'ENOENT') {
      return [] as Awaited<ReturnType<typeof readdir>>;
    }
    throw err;
  });

  const sidecars = new Map<string, string>();
  for (const entry of entries) {
    const entryName = Buffer.isBuffer(entry.name) ? entry.name.toString('utf8') : entry.name;
    if (!entry.isFile() && !entry.isSymbolicLink()) {
      continue;
    }
    if (!entryName.endsWith('.params.toml')) {
      continue;
    }
    const baseName = entryName.slice(0, -'.params.toml'.length);
    try {
      sidecars.set(normalizeRunActionId(baseName), join(directoryPath, entryName));
    } catch {
      logger.warn({ entryName, directoryPath }, 'Skipping invalid run action sidecar file name');
    }
  }

  const actions = new Map<string, RepoRunActionMetadata>();
  for (const entry of entries) {
    const entryName = Buffer.isBuffer(entry.name) ? entry.name.toString('utf8') : entry.name;
    if (!entry.isFile() && !entry.isSymbolicLink()) {
      continue;
    }
    if (entryName.endsWith('.params.toml')) {
      continue;
    }
    let actionId: string;
    try {
      actionId = normalizeRunActionId(entryName);
    } catch {
      logger.warn(
        { entryName, directoryPath },
        'Skipping invalid run action id discovered from repository contracts',
      );
      continue;
    }

    const sidecarPath = sidecars.get(actionId);
    const sidecar = sidecarPath ? await parseRunActionSidecar(sidecarPath) : undefined;
    actions.set(actionId, {
      parameters: sidecar?.parameters ?? [],
      steps: sidecar?.steps ?? [],
    });
  }

  return Object.fromEntries(Array.from(actions.entries()).sort(([a], [b]) => a.localeCompare(b)));
}

async function resolveRepoInspectionPath(
  row: RepoRow,
  repoConfig: RepoConfig,
  logFilePath: string,
  repoCacheRoot: string,
): Promise<string> {
  if (row.localPath) {
    return row.localPath;
  }

  const clonePath = join(repoCacheRoot, `${row.repoKey}.git`);
  const baseBranch = row.baseBranch?.trim() || 'main';
  await ensureClone(row.repoKey, repoConfig, clonePath, logFilePath, process.env, baseBranch, []);
  return clonePath;
}

function listFallbackActions(): Record<string, RepoRunActionMetadata> {
  const config = loadWorkerConfig();
  const runActions = config.run?.actions ?? {};
  const actions = new Map<string, RepoRunActionMetadata>();

  for (const [rawActionId, actionConfig] of Object.entries(runActions)) {
    const fallbackCommand =
      actionConfig.fallbackCommand?.map((segment) => segment.trim()).filter(Boolean) ?? [];
    if (!fallbackCommand.length) {
      continue;
    }
    try {
      actions.set(normalizeRunActionId(rawActionId), {
        parameters: [],
        steps: [],
      });
    } catch {
      logger.warn(
        { actionId: rawActionId },
        'Skipping invalid run action id discovered from worker fallback command config',
      );
    }
  }

  return Object.fromEntries(Array.from(actions.entries()).sort(([a], [b]) => a.localeCompare(b)));
}

async function syncRepoRunActionsRow(
  row: RepoRow,
  logFilePath: string,
  options: {
    repoCacheRoot: string;
    fallbackActions: Record<string, RepoRunActionMetadata>;
  },
): Promise<{ updated: boolean }> {
  const repoConfig = toRepoConfig(row);
  const inspectionPath = await resolveRepoInspectionPath(
    row,
    repoConfig,
    logFilePath,
    options.repoCacheRoot,
  );
  const contractActions = await listRunActionsFromRepoPath(inspectionPath);
  const actions = {
    ...options.fallbackActions,
    ...contractActions,
  };
  const syncedAt = new Date().toISOString();

  const providerData = withRepoRunActionsMetadata(repoConfig.providerData, {
    actions,
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
  const fallbackActions = listFallbackActions();
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
      await syncRepoRunActionsRow(row, logFilePath, {
        repoCacheRoot: config.repoCacheRoot,
        fallbackActions,
      });
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
