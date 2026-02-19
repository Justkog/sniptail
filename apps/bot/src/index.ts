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
  const unknownChannels = config.enabledChannels.filter(
    (provider) => provider !== 'slack' && provider !== 'discord',
  );
  if (unknownChannels.length) {
    logger.warn(
      { channels: unknownChannels },
      'Unsupported channels are enabled but no bot runtime adapter is registered for them',
    );
  }
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
    discordClient = await startDiscordBot(jobQueue, bootstrapQueue, workerEventQueue);
  }

  if (!slackApp && !discordClient) {
    logger.error(
      { enabledChannels: config.enabledChannels },
      'No supported bot providers enabled. Enable slack/discord via [channels.<provider>] configuration.',
    );
    process.exitCode = 1;
    return;
  }

  startBotEventWorker({
    redisUrl: config.redisUrl,
    ...(slackApp && { slackApp }),
    ...(discordClient && { discordClient }),
  });
})();
