import { loadCoreConfig } from '../config/config.js';
import type { CoreConfig } from '../config/types.js';
import { getJobRegistryDb } from '../db/index.js';
import {
  createPgAgentSessionOwnershipRegistryStore,
  createPgWorkerCapabilityRegistryStore,
} from './pgRegistryStores.js';
import {
  createRedisAgentSessionOwnershipRegistryStore,
  createRedisWorkerCapabilityRegistryStore,
} from './redisRegistryStores.js';
import {
  createSqliteAgentSessionOwnershipRegistryStore,
  createSqliteWorkerCapabilityRegistryStore,
} from './sqliteRegistryStores.js';
import type { AgentSessionOwnershipRegistryStore, WorkerCapabilityRegistryStore } from './types.js';

type RegistryStoreFactoryConfig = Pick<
  CoreConfig,
  'registryDriver' | 'registryPath' | 'registryPgUrl' | 'registryRedisUrl' | 'registryNamespace'
>;

let redisWorkerCapabilityStore: WorkerCapabilityRegistryStore | undefined;
let redisAgentSessionOwnershipStore: AgentSessionOwnershipRegistryStore | undefined;

function requireRegistryPath(config: RegistryStoreFactoryConfig): string {
  if (!config.registryPath) {
    throw new Error('SNIPTAIL_REGISTRY_PATH is required when SNIPTAIL_REGISTRY_DB=sqlite');
  }
  return config.registryPath;
}

function requireRegistryPgUrl(config: RegistryStoreFactoryConfig): string {
  if (!config.registryPgUrl) {
    throw new Error('SNIPTAIL_REGISTRY_PG_URL is required when SNIPTAIL_REGISTRY_DB=pg');
  }
  return config.registryPgUrl;
}

function requireRegistryRedisUrl(config: RegistryStoreFactoryConfig): string {
  if (!config.registryRedisUrl) {
    throw new Error('SNIPTAIL_REGISTRY_REDIS_URL is required when SNIPTAIL_REGISTRY_DB=redis');
  }
  return config.registryRedisUrl;
}

export async function createWorkerCapabilityRegistryStore(
  config: RegistryStoreFactoryConfig,
): Promise<WorkerCapabilityRegistryStore> {
  switch (config.registryDriver) {
    case 'sqlite': {
      requireRegistryPath(config);
      const client = await getJobRegistryDb();
      if (client.kind !== 'sqlite') {
        throw new Error(`Expected sqlite worker capability registry client, got ${client.kind}`);
      }
      return createSqliteWorkerCapabilityRegistryStore(client);
    }
    case 'pg': {
      requireRegistryPgUrl(config);
      const client = await getJobRegistryDb();
      if (client.kind !== 'pg') {
        throw new Error(`Expected pg worker capability registry client, got ${client.kind}`);
      }
      return createPgWorkerCapabilityRegistryStore(client);
    }
    case 'redis': {
      if (!redisWorkerCapabilityStore) {
        redisWorkerCapabilityStore = createRedisWorkerCapabilityRegistryStore(
          requireRegistryRedisUrl(config),
          { namespace: config.registryNamespace },
        );
      }
      return redisWorkerCapabilityStore;
    }
    default: {
      const exhaustive: never = config.registryDriver;
      throw new Error(`Unsupported SNIPTAIL_REGISTRY_DB: ${String(exhaustive)}`);
    }
  }
}

export async function createAgentSessionOwnershipRegistryStore(
  config: RegistryStoreFactoryConfig,
): Promise<AgentSessionOwnershipRegistryStore> {
  switch (config.registryDriver) {
    case 'sqlite': {
      requireRegistryPath(config);
      const client = await getJobRegistryDb();
      if (client.kind !== 'sqlite') {
        throw new Error(
          `Expected sqlite agent session ownership registry client, got ${client.kind}`,
        );
      }
      return createSqliteAgentSessionOwnershipRegistryStore(client);
    }
    case 'pg': {
      requireRegistryPgUrl(config);
      const client = await getJobRegistryDb();
      if (client.kind !== 'pg') {
        throw new Error(`Expected pg agent session ownership registry client, got ${client.kind}`);
      }
      return createPgAgentSessionOwnershipRegistryStore(client);
    }
    case 'redis': {
      if (!redisAgentSessionOwnershipStore) {
        redisAgentSessionOwnershipStore = createRedisAgentSessionOwnershipRegistryStore(
          requireRegistryRedisUrl(config),
          { namespace: config.registryNamespace },
        );
      }
      return redisAgentSessionOwnershipStore;
    }
    default: {
      const exhaustive: never = config.registryDriver;
      throw new Error(`Unsupported SNIPTAIL_REGISTRY_DB: ${String(exhaustive)}`);
    }
  }
}

export async function getWorkerCapabilityRegistryStore(): Promise<WorkerCapabilityRegistryStore> {
  return createWorkerCapabilityRegistryStore(loadCoreConfig());
}

export async function getAgentSessionOwnershipRegistryStore(): Promise<AgentSessionOwnershipRegistryStore> {
  return createAgentSessionOwnershipRegistryStore(loadCoreConfig());
}

export function resetRegistryStoreFactoryCaches(): void {
  redisWorkerCapabilityStore = undefined;
  redisAgentSessionOwnershipStore = undefined;
}
