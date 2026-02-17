import { parseRepoAllowlist, writeRepoAllowlist } from '../config/repoAllowlist.js';
import { logger } from '../logger.js';
import type { RepoConfig } from '../types/job.js';
import { getRepoProvider, inferRepoProvider } from './providers.js';
import { getRepoCatalogStore } from './catalogStore.js';
import type { RepoProvider, RepoRow } from './catalogTypes.js';

export type { RepoProvider } from './catalogTypes.js';

type SeedMode = 'if-empty' | 'upsert';

function normalizeBaseBranch(value?: string): string {
  const trimmed = value?.trim();
  return trimmed ? trimmed : 'main';
}

function validateRepoForProvider(provider: RepoProvider, repo: RepoConfig): void {
  const handler = getRepoProvider(provider);
  if (!handler) {
    throw new Error(`Unsupported repository provider: ${provider}`);
  }
  handler.validateRepoConfig?.(repo);
}

function toRepoConfig(row: RepoRow): RepoConfig {
  const baseBranch = normalizeBaseBranch(row.baseBranch);
  const provider = getRepoProvider(row.provider);
  const providerData =
    provider?.deserializeProviderData?.({
      ...(row.providerData ? { providerData: row.providerData } : {}),
      ...(row.projectId !== undefined ? { legacyProjectId: row.projectId } : {}),
    }) ?? row.providerData;
  const projectIdRaw = providerData?.projectId;
  const projectId =
    typeof projectIdRaw === 'number' &&
    Number.isFinite(projectIdRaw) &&
    Number.isInteger(projectIdRaw)
      ? projectIdRaw
      : row.projectId;
  return {
    provider: row.provider,
    ...(providerData ? { providerData } : {}),
    ...(row.sshUrl ? { sshUrl: row.sshUrl } : {}),
    ...(row.localPath ? { localPath: row.localPath } : {}),
    ...(projectId !== undefined ? { projectId } : {}),
    ...(baseBranch ? { baseBranch } : {}),
  };
}

function normalizeRecord(record: RepoConfig): RepoConfig {
  const baseBranch = normalizeBaseBranch(record.baseBranch);
  return {
    ...(record.provider ? { provider: record.provider } : {}),
    ...(record.providerData ? { providerData: record.providerData } : {}),
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
  const provider = options.provider ?? inferRepoProvider(normalized);
  const handler = getRepoProvider(provider);
  if (!handler) {
    throw new Error(`Unsupported repository provider: ${provider}`);
  }
  validateRepoForProvider(provider, normalized);
  const store = await getRepoCatalogStore();

  const hasLocalPath = provider === 'local' && Boolean(normalized.localPath);
  const shouldUseSshUrl = provider !== 'local' && Boolean(normalized.sshUrl);
  const providerData =
    handler.serializeProviderData?.({ repo: normalized }) ?? normalized.providerData;
  const projectIdRaw = providerData?.projectId;
  const projectId =
    typeof projectIdRaw === 'number' &&
    Number.isFinite(projectIdRaw) &&
    Number.isInteger(projectIdRaw)
      ? projectIdRaw
      : normalized.projectId;

  await store.upsertRow({
    repoKey,
    provider,
    ...(providerData ? { providerData } : {}),
    ...(shouldUseSshUrl ? { sshUrl: normalized.sshUrl } : {}),
    ...(hasLocalPath ? { localPath: normalized.localPath } : {}),
    ...(projectId !== undefined ? { projectId } : {}),
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
      ...(existing.providerData ? { providerData: existing.providerData } : {}),
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
