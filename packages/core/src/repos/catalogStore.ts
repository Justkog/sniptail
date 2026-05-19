import { loadCoreConfig } from '../config/config.js';
import type { CoreConfig, RegistryDriver } from '../config/types.js';
import { getJobRegistryDb } from '../db/index.js';
import { createPgRepoCatalogStore } from './catalogPgStore.js';
import { createRedisRepoCatalogStore } from './catalogRedisStore.js';
import { createSqliteRepoCatalogStore } from './catalogSqliteStore.js';
import type { RepoCatalogStore } from './catalogTypes.js';

type StoreFactory = (config: CoreConfig) => Promise<RepoCatalogStore>;

async function createPgStore(): Promise<RepoCatalogStore> {
  const client = await getJobRegistryDb();
  if (client.kind !== 'pg') {
    throw new Error(`Expected pg client for repository catalog, got ${client.kind}`);
  }
  return createPgRepoCatalogStore(client);
}

async function createSqliteStore(): Promise<RepoCatalogStore> {
  const client = await getJobRegistryDb();
  if (client.kind !== 'sqlite') {
    throw new Error(`Expected sqlite client for repository catalog, got ${client.kind}`);
  }
  return createSqliteRepoCatalogStore(client);
}

function createRedisStore(config: CoreConfig): Promise<RepoCatalogStore> {
  if (!config.registryRedisUrl) {
    throw new Error('SNIPTAIL_REGISTRY_REDIS_URL is required when SNIPTAIL_REGISTRY_DB=redis');
  }
  return Promise.resolve(createRedisRepoCatalogStore(config.registryRedisUrl));
}

const STORE_FACTORIES: Record<RegistryDriver, StoreFactory> = {
  pg: createPgStore,
  sqlite: createSqliteStore,
  redis: createRedisStore,
};

let storePromise: Promise<RepoCatalogStore> | undefined;

export async function getRepoCatalogStore(): Promise<RepoCatalogStore> {
  if (!storePromise) {
    const config = loadCoreConfig();
    storePromise = STORE_FACTORIES[config.registryDriver](config);
  }
  return storePromise;
}

export async function closeRepoCatalogStore(): Promise<void> {
  if (!storePromise) return;
  try {
    const store = await storePromise;
    if (store.close) {
      await store.close();
    }
  } finally {
    storePromise = undefined;
  }
}

export function resetRepoCatalogStore(): void {
  storePromise = undefined;
}
