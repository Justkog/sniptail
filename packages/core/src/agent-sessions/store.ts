import { loadCoreConfig } from '../config/config.js';
import { getJobRegistryDb } from '../db/index.js';
import type { AgentSessionStore } from './types.js';
import { createPgAgentSessionStore } from './pgStore.js';
import { createRedisAgentSessionStore } from './redisStore.js';
import { createSqliteAgentSessionStore } from './sqliteStore.js';

export async function getAgentSessionStore(): Promise<AgentSessionStore> {
  const config = loadCoreConfig();
  switch (config.registryDriver) {
    case 'sqlite': {
      const client = await getJobRegistryDb();
      if (client.kind !== 'sqlite') {
        throw new Error(`Expected sqlite agent session registry client, got ${client.kind}`);
      }
      return createSqliteAgentSessionStore(client);
    }
    case 'pg': {
      if (!config.registryPgUrl) {
        throw new Error('SNIPTAIL_REGISTRY_PG_URL is required when SNIPTAIL_REGISTRY_DB=pg');
      }
      const client = await getJobRegistryDb();
      if (client.kind !== 'pg') {
        throw new Error(`Expected pg agent session registry client, got ${client.kind}`);
      }
      return createPgAgentSessionStore(client);
    }
    case 'redis': {
      if (!config.registryRedisUrl) {
        throw new Error('SNIPTAIL_REGISTRY_REDIS_URL is required when SNIPTAIL_REGISTRY_DB=redis');
      }
      return createRedisAgentSessionStore(config.registryRedisUrl, {
        namespace: config.registryNamespace,
      });
    }
    default: {
      const exhaustive: never = config.registryDriver;
      throw new Error(`Unsupported SNIPTAIL_REGISTRY_DB: ${String(exhaustive)}`);
    }
  }
}
