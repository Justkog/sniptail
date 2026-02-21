import type { App } from '@slack/bolt';
import type { QueuePublisher } from '@sniptail/core/queue/queueTransportTypes.js';
import type { BotConfig } from '@sniptail/core/config/config.js';
import type { SlackIds } from '@sniptail/core/slack/ids.js';
import type { BootstrapRequest } from '@sniptail/core/types/bootstrap.js';
import type { JobSpec } from '@sniptail/core/types/job.js';
import type { WorkerEvent } from '@sniptail/core/types/worker-event.js';
import type { PermissionsRuntimeService } from '../../permissions/permissionsRuntimeService.js';

export type SlackHandlerContext = {
  app: App;
  slackIds: SlackIds;
  config: BotConfig;
  queue: QueuePublisher<JobSpec>;
  bootstrapQueue: QueuePublisher<BootstrapRequest>;
  workerEventQueue: QueuePublisher<WorkerEvent>;
  permissions: PermissionsRuntimeService;
};
