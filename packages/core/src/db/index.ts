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
      if (config.jobRegistryDriver === 'pg') {
        if (!config.jobRegistryPgUrl) {
          throw new Error('JOB_REGISTRY_PG_URL is required when JOB_REGISTRY_DB=pg');
        }
        return createPgClient(config.jobRegistryPgUrl);
      }
      return createSqliteClient(config.jobRegistryPath);
    })();
  }
  return jobRegistryClient;
}

export function resetJobRegistryDb(): void {
  jobRegistryClient = null;
}
