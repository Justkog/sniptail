import { loadBotConfig } from '@sniptail/core/config/config.js';
import type { QueuePublisher } from '@sniptail/core/queue/queueTransportTypes.js';
import type { BootstrapRequest } from '@sniptail/core/types/bootstrap.js';
import type { JobSpec } from '@sniptail/core/types/job.js';
import type { WorkerEvent } from '@sniptail/core/types/worker-event.js';
import { logger } from '@sniptail/core/logger.js';
import { PermissionsRuntimeService } from '../permissions/permissionsRuntimeService.js';
import type { TelegramHandlerContext } from './context.js';
import { registerTelegramHandlers } from './handlers.js';

export async function startTelegramBot(
  queue: QueuePublisher<JobSpec>,
  bootstrapQueue: QueuePublisher<BootstrapRequest>,
  workerEventQueue: QueuePublisher<WorkerEvent>,
) {
  const config = loadBotConfig();
  if (!config.telegram) {
    throw new Error(
      'Telegram is not configured. Enable channels.telegram in sniptail.bot.toml and set TELEGRAM_BOT_TOKEN.',
    );
  }

  const { Bot } = await import('grammy');
  const bot = new Bot(config.telegram.botToken);
  await bot.init();
  const context: TelegramHandlerContext = {
    bot,
    config,
    queue,
    bootstrapQueue,
    workerEventQueue,
    permissions: new PermissionsRuntimeService({
      config,
      queue,
      bootstrapQueue,
      workerEventQueue,
    }),
  };

  registerTelegramHandlers(context);

  bot.catch((err) => {
    logger.error({ err }, 'Telegram bot error');
  });

  await bot.start();
  logger.info(`🤖 ${config.botName} Telegram bot is running`);
  return bot;
}
