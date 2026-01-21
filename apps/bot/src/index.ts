import 'dotenv/config';
import { logger } from '@sniptail/core/logger.js';

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

  const { loadBotConfig } = await import('@sniptail/core/config/index.js');
  const { createJobQueue } = await import('@sniptail/core/queue/index.js');
  const { createSlackApp } = await import('./slack/app.js');
  const { startBotEventWorker } = await import('./botEventWorker.js');

  const config = loadBotConfig();
  const jobQueue = createJobQueue(config.redisUrl);
  const app = createSlackApp(jobQueue);

  await app.start();
  startBotEventWorker(app, config.redisUrl);
  logger.info(`⚡️ ${config.botName} is running (Socket Mode)`);
})();
