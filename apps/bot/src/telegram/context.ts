import type { Bot } from 'grammy';
import type { QueueTransportRuntime } from '@sniptail/core/queue/queueTransportTypes.js';
import type { BotConfig } from '@sniptail/core/config/config.js';
import type { PermissionsRuntimeService } from '../permissions/permissionsRuntimeService.js';

export type TelegramHandlerContext = {
  bot: Bot;
  config: BotConfig;
  queueRuntime: QueueTransportRuntime;
  permissions: PermissionsRuntimeService;
};
