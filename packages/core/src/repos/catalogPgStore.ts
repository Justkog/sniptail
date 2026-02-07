import { asc, eq } from 'drizzle-orm';
import type { PgJobRegistryClient } from '../db/index.js';
import { repositories } from '../db/pg/schema.js';
import type { RepoCatalogStore, RepoRow } from './catalogTypes.js';

export function createPgRepoCatalogStore(client: PgJobRegistryClient): RepoCatalogStore {
  return {
    kind: 'pg',
    async listActiveRows(): Promise<RepoRow[]> {
      const rows = await client.db
        .select({
          repoKey: repositories.repoKey,
          provider: repositories.provider,
          sshUrl: repositories.sshUrl,
          localPath: repositories.localPath,
          projectId: repositories.projectId,
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
        baseBranch: row.baseBranch,
        isActive: Boolean(row.isActive),
      }));
    },
    async upsertRow(row: RepoRow): Promise<void> {
      const now = new Date();
      await client.db
        .insert(repositories)
        .values({
          repoKey: row.repoKey,
          provider: row.provider,
          ...(row.sshUrl ? { sshUrl: row.sshUrl } : {}),
          ...(row.localPath ? { localPath: row.localPath } : {}),
          ...(row.projectId !== undefined ? { projectId: row.projectId } : {}),
          baseBranch: row.baseBranch,
          isActive: row.isActive,
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: repositories.repoKey,
          set: {
            provider: row.provider,
            ...(row.sshUrl ? { sshUrl: row.sshUrl } : { sshUrl: null }),
            ...(row.localPath ? { localPath: row.localPath } : { localPath: null }),
            ...(row.projectId !== undefined ? { projectId: row.projectId } : { projectId: null }),
            baseBranch: row.baseBranch,
            isActive: row.isActive,
            updatedAt: now,
          },
        });
    },
  };
}
