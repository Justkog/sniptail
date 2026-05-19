import type { Client } from 'discord.js';
import type { QueueTransportRuntime } from '@sniptail/core/queue/queueTransportTypes.js';
import type { BotConfig } from '@sniptail/core/config/config.js';
import type { PermissionsRuntimeService } from '../permissions/permissionsRuntimeService.js';

export type DiscordHandlerContext = {
  client: Client;
  config: BotConfig;
  queueRuntime: QueueTransportRuntime;
  permissions: PermissionsRuntimeService;
};
