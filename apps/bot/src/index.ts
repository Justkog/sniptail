import 'dotenv/config';
import { logger } from '@sniptail/core/logger.js';
import {
  createBootstrapQueue,
  createJobQueue,
  createWorkerEventQueue,
} from '@sniptail/core/queue/index.js';

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
  const { createSlackApp } = await import('./slack/app.js');
  const { startBotEventWorker } = await import('./botEventWorker.js');

  const config = loadBotConfig();
  const jobQueue = createJobQueue(config.redisUrl);
  const bootstrapQueue = createBootstrapQueue(config.redisUrl);
  const workerEventQueue = createWorkerEventQueue(config.redisUrl);
  const app = createSlackApp(jobQueue, bootstrapQueue, workerEventQueue);

  await app.start();
  startBotEventWorker(app, config.redisUrl);
  logger.info(`⚡️ ${config.botName} is running (Socket Mode)`);
})();
