import { asc, eq } from 'drizzle-orm';
import { parseRepoAllowlist, writeRepoAllowlist } from '../config/repoAllowlist.js';
import { getJobRegistryDb } from '../db/index.js';
import { repositories as pgRepositories } from '../db/pg/schema.js';
import { repositories as sqliteRepositories } from '../db/sqlite/schema.js';
import { logger } from '../logger.js';
import type { RepoConfig } from '../types/job.js';

export type RepoProvider = 'github' | 'gitlab' | 'local';

type RepoRow = {
  repoKey: string;
  provider: RepoProvider;
  sshUrl?: string;
  localPath?: string;
  projectId?: number;
  baseBranch: string;
  isActive: boolean;
};

type SeedMode = 'if-empty' | 'upsert';

function normalizeBaseBranch(value?: string): string {
  const trimmed = value?.trim();
  return trimmed ? trimmed : 'main';
}

function inferProvider(repo: RepoConfig): RepoProvider {
  if (repo.localPath) return 'local';
  if (repo.projectId !== undefined) return 'gitlab';
  if (repo.sshUrl?.toLowerCase().includes('gitlab')) return 'gitlab';
  return 'github';
}

function toRepoConfig(row: RepoRow): RepoConfig {
  const baseBranch = row.baseBranch.trim();
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
  const client = await getJobRegistryDb();
  if (client.kind === 'pg') {
    const rows = await client.db
      .select({
        repoKey: pgRepositories.repoKey,
        provider: pgRepositories.provider,
        sshUrl: pgRepositories.sshUrl,
        localPath: pgRepositories.localPath,
        projectId: pgRepositories.projectId,
        baseBranch: pgRepositories.baseBranch,
        isActive: pgRepositories.isActive,
      })
      .from(pgRepositories)
      .where(eq(pgRepositories.isActive, true))
      .orderBy(asc(pgRepositories.repoKey));
    return rows.map((row) => ({
      repoKey: row.repoKey,
      provider: row.provider,
      ...(row.sshUrl ? { sshUrl: row.sshUrl } : {}),
      ...(row.localPath ? { localPath: row.localPath } : {}),
      ...(row.projectId !== null && row.projectId !== undefined ? { projectId: row.projectId } : {}),
      baseBranch: normalizeBaseBranch(row.baseBranch),
      isActive: Boolean(row.isActive),
    }));
  }

  const rows = await client.db
    .select({
      repoKey: sqliteRepositories.repoKey,
      provider: sqliteRepositories.provider,
      sshUrl: sqliteRepositories.sshUrl,
      localPath: sqliteRepositories.localPath,
      projectId: sqliteRepositories.projectId,
      baseBranch: sqliteRepositories.baseBranch,
      isActive: sqliteRepositories.isActive,
    })
    .from(sqliteRepositories)
    .where(eq(sqliteRepositories.isActive, true))
    .orderBy(asc(sqliteRepositories.repoKey));
  return rows.map((row) => ({
    repoKey: row.repoKey,
    provider: row.provider,
    ...(row.sshUrl ? { sshUrl: row.sshUrl } : {}),
    ...(row.localPath ? { localPath: row.localPath } : {}),
    ...(row.projectId !== null && row.projectId !== undefined ? { projectId: row.projectId } : {}),
    baseBranch: normalizeBaseBranch(row.baseBranch),
    isActive: Boolean(row.isActive),
  }));
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
  const now = new Date();
  const nowIso = now.toISOString();

  const client = await getJobRegistryDb();
  if (client.kind === 'pg') {
    await client.db
      .insert(pgRepositories)
      .values({
        repoKey,
        provider,
        ...(normalized.sshUrl ? { sshUrl: normalized.sshUrl } : {}),
        ...(normalized.localPath ? { localPath: normalized.localPath } : {}),
        ...(normalized.projectId !== undefined ? { projectId: normalized.projectId } : {}),
        baseBranch: normalizeBaseBranch(normalized.baseBranch),
        isActive: true,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: pgRepositories.repoKey,
        set: {
          provider,
          ...(normalized.sshUrl ? { sshUrl: normalized.sshUrl } : { sshUrl: null }),
          ...(normalized.localPath ? { localPath: normalized.localPath } : { localPath: null }),
          ...(normalized.projectId !== undefined
            ? { projectId: normalized.projectId }
            : { projectId: null }),
          baseBranch: normalizeBaseBranch(normalized.baseBranch),
          isActive: true,
          updatedAt: now,
        },
      });
    return;
  }

  await client.db
    .insert(sqliteRepositories)
    .values({
      repoKey,
      provider,
      ...(normalized.sshUrl ? { sshUrl: normalized.sshUrl } : {}),
      ...(normalized.localPath ? { localPath: normalized.localPath } : {}),
      ...(normalized.projectId !== undefined ? { projectId: normalized.projectId } : {}),
      baseBranch: normalizeBaseBranch(normalized.baseBranch),
      isActive: true,
      createdAt: nowIso,
      updatedAt: nowIso,
    })
    .onConflictDoUpdate({
      target: sqliteRepositories.repoKey,
      set: {
        provider,
        ...(normalized.sshUrl ? { sshUrl: normalized.sshUrl } : { sshUrl: null }),
        ...(normalized.localPath ? { localPath: normalized.localPath } : { localPath: null }),
        ...(normalized.projectId !== undefined ? { projectId: normalized.projectId } : { projectId: null }),
        baseBranch: normalizeBaseBranch(normalized.baseBranch),
        isActive: true,
        updatedAt: nowIso,
      },
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
