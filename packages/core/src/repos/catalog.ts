import { parseRepoAllowlist, writeRepoAllowlist } from '../config/repoAllowlist.js';
import { logger } from '../logger.js';
import type { RepoConfig } from '../types/job.js';
import { getRepoCatalogStore } from './catalogStore.js';
import type { RepoProvider, RepoRow } from './catalogTypes.js';

export type { RepoProvider } from './catalogTypes.js';

type SeedMode = 'if-empty' | 'upsert';

function normalizeBaseBranch(value?: string): string {
  const trimmed = value?.trim();
  return trimmed ? trimmed : 'main';
}

function inferProvider(repo: RepoConfig): 'github' | 'gitlab' | 'local' {
  if (repo.localPath) return 'local';
  if (repo.projectId !== undefined) return 'gitlab';
  if (repo.sshUrl?.toLowerCase().includes('gitlab')) {
    throw new Error(
      `Repository appears to be a GitLab repository (sshUrl contains 'gitlab'), but projectId is not provided. Please add a projectId to the repository configuration.`,
    );
  }
  return 'github';
}

function validateRepoForProvider(provider: RepoProvider, repo: RepoConfig): void {
  if (provider === 'local') {
    if (!repo.localPath) {
      throw new Error('Local repositories require localPath.');
    }
    if (repo.sshUrl) {
      throw new Error('Local repositories must not define sshUrl.');
    }
    if (repo.projectId !== undefined) {
      throw new Error('Local repositories must not define projectId.');
    }
    return;
  }

  if (!repo.sshUrl) {
    throw new Error('Remote repositories require sshUrl.');
  }
  if (repo.localPath) {
    throw new Error('Remote repositories must not define localPath.');
  }

  if (provider === 'github' && repo.projectId !== undefined) {
    throw new Error('GitHub repositories must not define projectId.');
  }
  if (provider === 'gitlab' && repo.projectId === undefined) {
    throw new Error('GitLab repositories require projectId.');
  }
}

function toRepoConfig(row: RepoRow): RepoConfig {
  const baseBranch = normalizeBaseBranch(row.baseBranch);
  return {
    ...(row.sshUrl ? { sshUrl: row.sshUrl } : {}),
    ...(row.localPath ? { localPath: row.localPath } : {}),
    ...(row.projectId !== undefined ? { projectId: row.projectId } : {}),
    ...(baseBranch ? { baseBranch } : {}),
  };
}

function normalizeRecord(record: RepoConfig): RepoConfig {
  const baseBranch = normalizeBaseBranch(record.baseBranch);
  return {
    ...(record.sshUrl ? { sshUrl: record.sshUrl } : {}),
    ...(record.localPath ? { localPath: record.localPath } : {}),
    ...(record.projectId !== undefined ? { projectId: record.projectId } : {}),
    ...(baseBranch ? { baseBranch } : {}),
  };
}

function sanitizeRepoRows(rows: RepoRow[]): RepoRow[] {
  return rows.filter((row) => {
    if (!row.isActive) return false;
    if (row.localPath && !row.sshUrl) return true;
    return Boolean(row.sshUrl);
  });
}

async function listRepoRows(): Promise<RepoRow[]> {
  const store = await getRepoCatalogStore();
  return store.listActiveRows();
}

export async function loadRepoAllowlistFromCatalog(): Promise<Record<string, RepoConfig>> {
  const rows = sanitizeRepoRows(await listRepoRows());
  return rows.reduce<Record<string, RepoConfig>>((acc, row) => {
    acc[row.repoKey] = toRepoConfig(row);
    return acc;
  }, {});
}

export async function listRepoCatalogEntries(): Promise<RepoRow[]> {
  return sanitizeRepoRows(await listRepoRows());
}

export async function findRepoCatalogEntry(repoKey: string): Promise<RepoRow | undefined> {
  const rows = await listRepoCatalogEntries();
  return rows.find((row) => row.repoKey === repoKey);
}

export async function upsertRepoCatalogEntry(
  repoKey: string,
  repo: RepoConfig,
  options: { provider?: RepoProvider; isActive?: boolean } = {},
): Promise<void> {
  const normalized = normalizeRecord(repo);
  const provider = options.provider ?? inferProvider(normalized);
  validateRepoForProvider(provider, normalized);
  const store = await getRepoCatalogStore();

  const hasLocalPath = provider === 'local' && Boolean(normalized.localPath);
  const shouldUseSshUrl = provider !== 'local' && Boolean(normalized.sshUrl);

  await store.upsertRow({
    repoKey,
    provider,
    ...(shouldUseSshUrl ? { sshUrl: normalized.sshUrl } : {}),
    ...(hasLocalPath ? { localPath: normalized.localPath } : {}),
    ...(normalized.projectId !== undefined ? { projectId: normalized.projectId } : {}),
    baseBranch: normalizeBaseBranch(normalized.baseBranch),
    isActive: options.isActive ?? true,
  });
}

export async function deactivateRepoCatalogEntry(repoKey: string): Promise<boolean> {
  const existing = await findRepoCatalogEntry(repoKey);
  if (!existing) {
    return false;
  }
  await upsertRepoCatalogEntry(
    repoKey,
    {
      ...(existing.sshUrl ? { sshUrl: existing.sshUrl } : {}),
      ...(existing.localPath ? { localPath: existing.localPath } : {}),
      ...(existing.projectId !== undefined ? { projectId: existing.projectId } : {}),
      baseBranch: existing.baseBranch,
    },
    { provider: existing.provider, isActive: false },
  );
  return true;
}

async function seedRepoCatalogFromAllowlist(
  allowlist: Record<string, RepoConfig>,
): Promise<{ seeded: number; skipped: boolean }> {
  const entries = Object.entries(allowlist);
  for (const [repoKey, repoConfig] of entries) {
    await upsertRepoCatalogEntry(repoKey, repoConfig);
  }
  return { seeded: entries.length, skipped: false };
}

export async function seedRepoCatalogFromAllowlistFile(options: {
  filePath?: string;
  mode?: SeedMode;
}): Promise<{ seeded: number; skipped: boolean }> {
  const { filePath } = options;
  if (!filePath) {
    return { seeded: 0, skipped: true };
  }
  const mode = options.mode ?? 'if-empty';
  if (mode === 'if-empty') {
    const existing = await loadRepoAllowlistFromCatalog();
    if (Object.keys(existing).length > 0) {
      logger.info({ filePath, mode }, 'Repo catalog seed skipped because catalog is not empty');
      return { seeded: 0, skipped: true };
    }
  }
  const allowlist = parseRepoAllowlist(filePath);
  const seeded = await seedRepoCatalogFromAllowlist(allowlist);
  logger.info(
    { filePath, mode, seeded: seeded.seeded, skipped: seeded.skipped },
    'Repo catalog seed completed',
  );
  return seeded;
}

export async function syncAllowlistFileFromCatalog(filePath: string): Promise<number> {
  const allowlist = await loadRepoAllowlistFromCatalog();
  await writeRepoAllowlist(filePath, allowlist);
  return Object.keys(allowlist).length;
}
