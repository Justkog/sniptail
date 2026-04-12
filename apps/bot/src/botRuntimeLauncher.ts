import { loadBotConfig } from '@sniptail/core/config/config.js';
import { debugFor, isDebugNamespaceEnabled, logger } from '@sniptail/core/logger.js';
import { createQueueTransportRuntime } from '@sniptail/core/queue/queueTransportFactory.js';
import type {
  QueueConsumerHandle,
  QueueTransportRuntime,
} from '@sniptail/core/queue/queueTransportTypes.js';
import { hostname } from 'node:os';
import { createSlackApp } from './slack/app.js';
import { startDiscordBot } from './discord/app.js';
import { startTelegramBot } from './telegram/app.js';
import { startBotEventWorker } from './botEventWorker.js';

export type BotRuntimeHandle = {
  close(): Promise<void>;
};

export type StartBotRuntimeOptions = {
  queueRuntime?: QueueTransportRuntime;
};

export async function startBotRuntime(
  options: StartBotRuntimeOptions = {},
): Promise<BotRuntimeHandle> {
  const config = loadBotConfig();
  if (config.queueDriver === 'inproc' && !options.queueRuntime) {
    throw new Error(
      'queue_driver="inproc" requires a shared local runtime. Use "sniptail local" instead of running "sniptail bot" directly.',
    );
  }

  const queueRuntime =
    options.queueRuntime ??
    createQueueTransportRuntime({
      driver: config.queueDriver,
      ...(config.redisUrl ? { redisUrl: config.redisUrl } : {}),
    });
  const closeQueueRuntimeOnShutdown = !options.queueRuntime;
  debugSlack(
    {
      queueDriver: queueRuntime.driver,
      pid: process.pid,
      host: hostname(),
      nodeEnv: process.env.NODE_ENV,
      botName: config.botName,
    },
    'Starting bot runtime',
  );

  const unknownChannels = config.enabledChannels.filter(
    (provider) => provider !== 'slack' && provider !== 'discord' && provider !== 'telegram',
  );
  if (unknownChannels.length) {
    logger.warn(
      { channels: unknownChannels },
      'Unsupported channels are enabled but no bot runtime adapter is registered for them',
    );
  }

  let slackApp: Awaited<ReturnType<typeof createSlackApp>> | undefined;
  let discordClient: Awaited<ReturnType<typeof startDiscordBot>> | undefined;
  let telegramBot: Awaited<ReturnType<typeof startTelegramBot>> | undefined;
  let botEventConsumer: QueueConsumerHandle | undefined;

  try {
    if (config.slackEnabled) {
      slackApp = createSlackApp(
        queueRuntime.queues.jobs,
        queueRuntime.queues.bootstrap,
        queueRuntime.queues.workerEvents,
      );
      await slackApp.start();
      await debugLogSlackRuntimeIdentity(slackApp);
      logger.info(`⚡️ ${config.botName} Slack bot is running (Socket Mode)`);
    }

    if (config.discordEnabled) {
      discordClient = await startDiscordBot(
        queueRuntime.queues.jobs,
        queueRuntime.queues.bootstrap,
        queueRuntime.queues.workerEvents,
      );
    }

    if (config.telegramEnabled) {
      telegramBot = await startTelegramBot(
        queueRuntime.queues.jobs,
        queueRuntime.queues.bootstrap,
        queueRuntime.queues.workerEvents,
      );
    }

    if (!slackApp && !discordClient && !telegramBot) {
      throw new Error(
        `No supported bot providers enabled. Enabled channels: ${config.enabledChannels.join(', ') || '(none)'}`,
      );
    }

    botEventConsumer = startBotEventWorker({
      queueRuntime,
      ...(slackApp ? { slackApp } : {}),
      ...(discordClient ? { discordClient } : {}),
      ...(telegramBot ? { telegramBot } : {}),
    });
  } catch (err) {
    if (botEventConsumer) {
      await botEventConsumer.close();
    }
    if (slackApp) {
      await slackApp.stop();
    }
    if (discordClient) {
      discordClient.destroy().catch((destroyErr) => {
        logger.error({ err: destroyErr }, 'Error while destroying Discord client during shutdown');
      });
    }
    if (telegramBot) {
      telegramBot.stop();
    }
    if (closeQueueRuntimeOnShutdown) {
      await queueRuntime.close();
    }
    throw err;
  }

  return {
    async close() {
      if (botEventConsumer) {
        await botEventConsumer.close();
      }
      if (slackApp) {
        await slackApp.stop();
      }
      if (discordClient) {
        discordClient.destroy().catch((destroyErr) => {
          logger.error(
            { err: destroyErr },
            'Error while destroying Discord client during shutdown',
          );
        });
      }
      if (telegramBot) {
        telegramBot.stop();
      }
      if (closeQueueRuntimeOnShutdown) {
        await queueRuntime.close();
      }
    },
  };
}

async function debugLogSlackRuntimeIdentity(
  slackApp: Awaited<ReturnType<typeof createSlackApp>>,
): Promise<void> {
  if (!isDebugNamespaceEnabled('slack')) {
    return;
  }
  try {
    const auth = await slackApp.client.auth.test();
    debugSlack(
      {
        teamId: auth.team_id,
        team: auth.team,
        botUserId: auth.user_id,
        botId: auth.bot_id,
        url: auth.url,
      },
      'Slack runtime identity',
    );
  } catch (err) {
    debugSlack({ err }, 'Failed to resolve Slack runtime identity');
  }
}

const debugSlack = debugFor('slack');
