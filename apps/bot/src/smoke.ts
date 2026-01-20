import { loadBotConfig } from '@sniptail/core/config/env.js';
import { logger } from '@sniptail/core/logger.js';
import { createConnectionOptions } from '@sniptail/core/queue/index.js';
import { buildSlackIds } from '@sniptail/core/slack/ids.js';

// eslint-disable-next-line @typescript-eslint/require-await
export async function runSmokeTest() {
  logger.info('Running smoke test');

  const config = loadBotConfig();
  createConnectionOptions(config.redisUrl);
  buildSlackIds(config.botName);

  logger.info('Smoke test passed');
}
