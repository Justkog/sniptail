import 'dotenv/config';
import { logger } from './logger.js';

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

  const { config } = await import('./config/index.js');
  const { createQueue } = await import('./queue/index.js');
  const { createSlackApp } = await import('./slack/app.js');
  const { startWorker } = await import('./worker/index.js');

  const queue = createQueue(config.redisUrl);
  const app = createSlackApp(queue);

  await app.start();
  startWorker(app, config.redisUrl, queue);
  logger.info(`⚡️ ${config.botName} is running (Socket Mode)`);
})();
