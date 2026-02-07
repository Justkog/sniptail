import { loadCoreConfig } from '../config/config.js';
import { getJobRegistryDb } from '../db/index.js';
import type { JobRegistryStore } from './registryTypes.js';
import { createPgJobRegistryStore } from './registryPgStore.js';
import { createRedisJobRegistryStore } from './registryRedisStore.js';
import { createSqliteJobRegistryStore } from './registrySqliteStore.js';

let redisStore: JobRegistryStore | undefined;

export async function getJobRegistryStore(): Promise<JobRegistryStore> {
  const config = loadCoreConfig();
  if (config.jobRegistryDriver === 'redis') {
    if (!config.jobRegistryRedisUrl) {
      throw new Error('JOB_REGISTRY_REDIS_URL is required when JOB_REGISTRY_DB=redis');
    }
    if (!redisStore) {
      redisStore = createRedisJobRegistryStore(config.jobRegistryRedisUrl);
    }
    return redisStore;
  }

  const client = await getJobRegistryDb();
  if (client.kind === 'pg') {
    return createPgJobRegistryStore(client);
  }
  return createSqliteJobRegistryStore(client);
}
