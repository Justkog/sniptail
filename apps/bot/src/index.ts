import 'dotenv/config';
import { logger } from '@sniptail/core/logger.js';
import { startBotRuntime } from './botRuntimeLauncher.js';

const isDryRun = process.env.SNIPTAIL_DRY_RUN === '1';

void (async () => {
  if (isDryRun) {
    try {
      const { runSmokeTest } = await import('./smoke.js');
      await runSmokeTest();
    } catch (err) {
      logger.error({ err }, 'Smoke test failed');
      process.exitCode = 1;
    }
    return;
  }

  const { loadBotConfig } = await import('@sniptail/core/config/config.js');
  loadBotConfig();

  await startBotRuntime();
})();
