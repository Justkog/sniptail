import type { App } from '@slack/bolt';
import type { Queue } from 'bullmq';
import type { BotConfig } from '@sniptail/core/config/index.js';
import type { SlackIds } from '@sniptail/core/slack/ids.js';
import type { BootstrapRequest } from '@sniptail/core/types/bootstrap.js';
import type { JobSpec } from '@sniptail/core/types/job.js';

export type SlackAppContext = {
  app: App;
  slackIds: SlackIds;
  config: BotConfig;
  queue: Queue<JobSpec>;
  bootstrapQueue: Queue<BootstrapRequest>;
};
