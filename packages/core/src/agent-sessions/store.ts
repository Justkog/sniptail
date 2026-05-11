import { loadCoreConfig } from '../config/config.js';
import { getJobRegistryDb } from '../db/index.js';
import type { AgentSessionStore } from './types.js';
import { createSqliteAgentSessionStore } from './sqliteStore.js';

export async function getAgentSessionStore(): Promise<AgentSessionStore> {
  const config = loadCoreConfig();
  switch (config.jobRegistryDriver) {
    case 'sqlite': {
      const client = await getJobRegistryDb();
      if (client.kind !== 'sqlite') {
        throw new Error(`Expected sqlite agent session registry client, got ${client.kind}`);
      }
      return createSqliteAgentSessionStore(client);
    }
    case 'pg':
      throw new Error('Agent session registry is not supported yet when JOB_REGISTRY_DB=pg');
    case 'redis':
      throw new Error('Agent session registry is not supported yet when JOB_REGISTRY_DB=redis');
    default: {
      const exhaustive: never = config.jobRegistryDriver;
      throw new Error(`Unsupported JOB_REGISTRY_DB: ${String(exhaustive)}`);
    }
  }
}
