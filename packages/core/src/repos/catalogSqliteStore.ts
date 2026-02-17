import { asc, eq } from 'drizzle-orm';
import type { SqliteJobRegistryClient } from '../db/index.js';
import { repositories } from '../db/sqlite/schema.js';
import type { RepoCatalogStore, RepoRow } from './catalogTypes.js';

function parseProviderData(raw?: string | null): Record<string, unknown> | undefined {
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return undefined;
    return parsed as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

function buildProviderData(
  raw?: string | null,
): { providerData: Record<string, unknown> } | Record<string, never> {
  const providerData = parseProviderData(raw);
  return providerData ? { providerData } : {};
}

export function createSqliteRepoCatalogStore(client: SqliteJobRegistryClient): RepoCatalogStore {
  return {
    kind: 'sqlite',
    async listActiveRows(): Promise<RepoRow[]> {
      const rows = await client.db
        .select({
          repoKey: repositories.repoKey,
          provider: repositories.provider,
          sshUrl: repositories.sshUrl,
          localPath: repositories.localPath,
          projectId: repositories.projectId,
          providerData: repositories.providerData,
          baseBranch: repositories.baseBranch,
          isActive: repositories.isActive,
        })
        .from(repositories)
        .where(eq(repositories.isActive, true))
        .orderBy(asc(repositories.repoKey));

      return rows.map((row) => ({
        repoKey: row.repoKey,
        provider: row.provider,
        ...(row.sshUrl ? { sshUrl: row.sshUrl } : {}),
        ...(row.localPath ? { localPath: row.localPath } : {}),
        ...(row.projectId !== null && row.projectId !== undefined
          ? { projectId: row.projectId }
          : {}),
        ...buildProviderData(row.providerData),
        baseBranch: row.baseBranch,
        isActive: Boolean(row.isActive),
      }));
    },
    async upsertRow(row: RepoRow): Promise<void> {
      const nowIso = new Date().toISOString();
      await client.db
        .insert(repositories)
        .values({
          repoKey: row.repoKey,
          provider: row.provider,
          ...(row.sshUrl ? { sshUrl: row.sshUrl } : {}),
          ...(row.localPath ? { localPath: row.localPath } : {}),
          ...(row.projectId !== undefined ? { projectId: row.projectId } : {}),
          ...(row.providerData ? { providerData: JSON.stringify(row.providerData) } : {}),
          baseBranch: row.baseBranch,
          isActive: row.isActive,
          createdAt: nowIso,
          updatedAt: nowIso,
        })
        .onConflictDoUpdate({
          target: repositories.repoKey,
          set: {
            provider: row.provider,
            ...(row.sshUrl ? { sshUrl: row.sshUrl } : { sshUrl: null }),
            ...(row.localPath ? { localPath: row.localPath } : { localPath: null }),
            ...(row.projectId !== undefined ? { projectId: row.projectId } : { projectId: null }),
            ...(row.providerData
              ? { providerData: JSON.stringify(row.providerData) }
              : { providerData: null }),
            baseBranch: row.baseBranch,
            isActive: row.isActive,
            updatedAt: nowIso,
          },
        });
    },
  };
}
