import 'dotenv/config';
import { logger } from '@sniptail/core/logger.js';
import {
  createBootstrapQueue,
  createJobQueue,
  createWorkerEventQueue,
} from '@sniptail/core/queue/queue.js';

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
  const { createSlackApp } = await import('./slack/app.js');
  const { startDiscordBot } = await import('./discord/app.js');
  const { startBotEventWorker } = await import('./botEventWorker.js');

  const config = loadBotConfig();
  const jobQueue = createJobQueue(config.redisUrl);
  const bootstrapQueue = createBootstrapQueue(config.redisUrl);
  const workerEventQueue = createWorkerEventQueue(config.redisUrl);
  let slackApp;
  let discordClient;

  if (config.slackEnabled) {
    slackApp = createSlackApp(jobQueue, bootstrapQueue, workerEventQueue);
    await slackApp.start();
    logger.info(`⚡️ ${config.botName} Slack bot is running (Socket Mode)`);
  }

  if (config.discordEnabled) {
    discordClient = await startDiscordBot(jobQueue, bootstrapQueue);
  }

  if (!slackApp && !discordClient) {
    logger.error('No bot providers enabled. Enable slack/discord in sniptail.bot.toml.');
    process.exitCode = 1;
    return;
  }

  startBotEventWorker({
    redisUrl: config.redisUrl,
    ...(slackApp && { slackApp }),
    ...(discordClient && { discordClient }),
  });
})();
