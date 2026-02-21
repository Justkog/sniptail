import { createInprocQueueTransportRuntime } from './queueTransportInprocDriver.js';
import { createRedisQueueTransportRuntime } from './queueTransportRedisDriver.js';
import type { QueueTransportConfig, QueueTransportRuntime } from './queueTransportTypes.js';

export function createQueueTransportRuntime(config: QueueTransportConfig): QueueTransportRuntime {
  switch (config.driver) {
    case 'redis': {
      if (!config.redisUrl) {
        throw new Error(
          'REDIS_URL (or redis_url in TOML) is required when queue_driver is set to "redis".',
        );
      }
      return createRedisQueueTransportRuntime(config.redisUrl);
    }
    case 'inproc':
      return createInprocQueueTransportRuntime();
    default: {
      const exhaustive: never = config.driver;
      throw new Error(`Unsupported queue driver: ${String(exhaustive)}`);
    }
  }
}
