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
      switch (config.jobRegistryDriver) {
        case 'pg':
          if (!config.jobRegistryPgUrl) {
            throw new Error('JOB_REGISTRY_PG_URL is required when JOB_REGISTRY_DB=pg');
          }
          return createPgClient(config.jobRegistryPgUrl);
        case 'sqlite':
          if (!config.jobRegistryPath) {
            throw new Error('JOB_REGISTRY_PATH is required when JOB_REGISTRY_DB=sqlite');
          }
          return createSqliteClient(config.jobRegistryPath);
        case 'redis':
          throw new Error('SQL job registry DB client is unavailable when JOB_REGISTRY_DB=redis');
        default: {
          const exhaustive: never = config.jobRegistryDriver;
          throw new Error(`Unsupported JOB_REGISTRY_DB: ${String(exhaustive)}`);
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
