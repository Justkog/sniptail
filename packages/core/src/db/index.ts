import { loadCoreConfig } from '../config/config.js';
import { createPgClient } from './pg/client.js';
import { createSqliteClient } from './sqlite/client.js';

export type SqliteJobRegistryClient = Awaited<ReturnType<typeof createSqliteClient>>;
export type PgJobRegistryClient = Awaited<ReturnType<typeof createPgClient>>;
export type JobRegistryClient = SqliteJobRegistryClient | PgJobRegistryClient;

let jobRegistryClient: Promise<JobRegistryClient> | null = null;

export async function getJobRegistryDb(): Promise<JobRegistryClient> {
  if (!jobRegistryClient) {
    jobRegistryClient = (async () => {
      const config = loadCoreConfig();
      switch (config.registryDriver) {
        case 'pg':
          if (!config.registryPgUrl) {
            throw new Error('SNIPTAIL_REGISTRY_PG_URL is required when SNIPTAIL_REGISTRY_DB=pg');
          }
          return createPgClient(config.registryPgUrl);
        case 'sqlite':
          if (!config.registryPath) {
            throw new Error('SNIPTAIL_REGISTRY_PATH is required when SNIPTAIL_REGISTRY_DB=sqlite');
          }
          return createSqliteClient(config.registryPath);
        case 'redis':
          throw new Error(
            'SQL job registry DB client is unavailable when SNIPTAIL_REGISTRY_DB=redis',
          );
        default: {
          const exhaustive: never = config.registryDriver;
          throw new Error(`Unsupported SNIPTAIL_REGISTRY_DB: ${String(exhaustive)}`);
        }
      }
    })();
  }
  return jobRegistryClient;
}

export function resetJobRegistryDb(): void {
  jobRegistryClient = null;
}

export async function closeJobRegistryDb(): Promise<void> {
  if (!jobRegistryClient) return;
  try {
    const client = await jobRegistryClient;
    if (client.kind === 'pg') {
      await client.pool.end();
    } else {
      client.raw.close();
    }
  } finally {
    jobRegistryClient = null;
  }
}
