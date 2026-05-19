import type { App } from '@slack/bolt';
import type { QueueTransportRuntime } from '@sniptail/core/queue/queueTransportTypes.js';
import type { BotConfig } from '@sniptail/core/config/config.js';
import type { SlackIds } from '@sniptail/core/slack/ids.js';
import type { PermissionsRuntimeService } from '../../permissions/permissionsRuntimeService.js';

export type SlackHandlerContext = {
  app: App;
  slackIds: SlackIds;
  config: BotConfig;
  queueRuntime: QueueTransportRuntime;
  permissions: PermissionsRuntimeService;
};
