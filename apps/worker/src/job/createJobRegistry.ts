import type { WorkerConfig } from '@sniptail/core/config/types.js';
import type { JobRegistry } from './jobRegistry.js';
import { DbJobRegistry } from './dbJobRegistry.js';

export function createJobRegistry(config: WorkerConfig): JobRegistry {
  // Driver-specific store selection is handled in @sniptail/core/jobs/registry.
  switch (config.jobRegistryDriver) {
    case 'pg':
    case 'sqlite':
    case 'redis':
      return new DbJobRegistry();
    default: {
      const exhaustive: never = config.jobRegistryDriver;
      throw new Error(`Unsupported job registry driver: ${String(exhaustive)}`);
    }
  }
}
