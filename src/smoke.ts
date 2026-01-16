import { loadConfig } from './config/env.js';
import { logger } from './logger.js';
import { createConnectionOptions } from './queue/index.js';
import { buildSlackIds } from './slack/ids.js';

export async function runSmokeTest() {
  logger.info('Running smoke test');

  const config = loadConfig();
  createConnectionOptions(config.redisUrl);
  buildSlackIds(config.botName);

  logger.info('Smoke test passed');
}
