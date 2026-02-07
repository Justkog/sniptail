import { getJobRegistryDb } from '../db/index.js';
import type { JobRegistryStore } from './registryTypes.js';
import { createPgJobRegistryStore } from './registryPgStore.js';
import { createSqliteJobRegistryStore } from './registrySqliteStore.js';

export async function getJobRegistryStore(): Promise<JobRegistryStore> {
  const client = await getJobRegistryDb();
  if (client.kind === 'pg') {
    return createPgJobRegistryStore(client);
  }
  return createSqliteJobRegistryStore(client);
}
