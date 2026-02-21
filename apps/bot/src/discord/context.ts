import type { Client } from 'discord.js';
import type { Queue } from 'bullmq';
import type { BotConfig } from '@sniptail/core/config/config.js';
import type { BootstrapRequest } from '@sniptail/core/types/bootstrap.js';
import type { JobSpec } from '@sniptail/core/types/job.js';
import type { WorkerEvent } from '@sniptail/core/types/worker-event.js';
import type { PermissionsRuntimeService } from '../permissions/permissionsRuntimeService.js';

export type DiscordHandlerContext = {
  client: Client;
  config: BotConfig;
  queue: Queue<JobSpec>;
  bootstrapQueue: Queue<BootstrapRequest>;
  workerEventQueue: Queue<WorkerEvent>;
  permissions: PermissionsRuntimeService;
};
