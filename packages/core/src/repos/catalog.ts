import { parseRepoAllowlist, writeRepoAllowlist } from '../config/repoAllowlist.js';
import { logger } from '../logger.js';
import type { RepoConfig } from '../types/job.js';
import { getRepoCatalogStore } from './catalogStore.js';
import type { RepoRow } from './catalogTypes.js';

export type { RepoProvider } from './catalogTypes.js';

type SeedMode = 'if-empty' | 'upsert';

function normalizeBaseBranch(value?: string): string {
  const trimmed = value?.trim();
  return trimmed ? trimmed : 'main';
}

function inferProvider(repo: RepoConfig): 'github' | 'gitlab' | 'local' {
  if (repo.localPath) return 'local';
  if (repo.projectId !== undefined) return 'gitlab';
  if (repo.sshUrl?.toLowerCase().includes('gitlab')) return 'gitlab';
  return 'github';
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

export async function upsertRepoCatalogEntry(repoKey: string, repo: RepoConfig): Promise<void> {
  const normalized = normalizeRecord(repo);
  const provider = inferProvider(normalized);
  const store = await getRepoCatalogStore();

  // Prioritize localPath over sshUrl to match worker behavior and satisfy DB constraint
  const useLocalPath = Boolean(normalized.localPath);
  const useSshUrl = !useLocalPath && Boolean(normalized.sshUrl);

  await store.upsertRow({
    repoKey,
    provider,
    ...(useSshUrl ? { sshUrl: normalized.sshUrl } : {}),
    ...(useLocalPath ? { localPath: normalized.localPath } : {}),
    ...(normalized.projectId !== undefined ? { projectId: normalized.projectId } : {}),
    baseBranch: normalizeBaseBranch(normalized.baseBranch),
    isActive: true,
  });
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
