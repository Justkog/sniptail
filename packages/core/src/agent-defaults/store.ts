import { loadCoreConfig } from '../config/config.js';
import { getJobRegistryDb } from '../db/index.js';
import type { AgentDefaultStore } from './types.js';
import { createSqliteAgentDefaultStore } from './sqliteStore.js';

export async function getAgentDefaultStore(): Promise<AgentDefaultStore> {
  const config = loadCoreConfig();
  switch (config.jobRegistryDriver) {
    case 'sqlite': {
      const client = await getJobRegistryDb();
      if (client.kind !== 'sqlite') {
        throw new Error(`Expected sqlite agent default registry client, got ${client.kind}`);
      }
      return createSqliteAgentDefaultStore(client);
    }
    case 'pg':
      throw new Error('Agent default registry is not supported yet when JOB_REGISTRY_DB=pg');
    case 'redis':
      throw new Error('Agent default registry is not supported yet when JOB_REGISTRY_DB=redis');
    default: {
      const exhaustive: never = config.jobRegistryDriver;
      throw new Error(`Unsupported JOB_REGISTRY_DB: ${String(exhaustive)}`);
    }
  }
}
