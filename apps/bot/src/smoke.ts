import { logger } from '@sniptail/core/logger.js';
import { buildSlackIds } from '@sniptail/core/slack/ids.js';

// eslint-disable-next-line @typescript-eslint/require-await
export async function runSmokeTest() {
  logger.info('Running smoke test');

  buildSlackIds('Sniptail');
  logger.info('Smoke test passed (dry run)');
}
