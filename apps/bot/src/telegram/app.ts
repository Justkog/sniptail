import { loadBotConfig } from '@sniptail/core/config/config.js';
import type { QueueTransportRuntime } from '@sniptail/core/queue/queueTransportTypes.js';
import { logger } from '@sniptail/core/logger.js';
import { PermissionsRuntimeService } from '../permissions/permissionsRuntimeService.js';
import type { TelegramHandlerContext } from './context.js';
import { registerTelegramHandlers } from './handlers.js';

export async function startTelegramBot(queueRuntime: QueueTransportRuntime) {
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
    queueRuntime,
    permissions: new PermissionsRuntimeService({
      config,
      queueRuntime,
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
