import { App } from '@slack/bolt';
import type { Queue } from 'bullmq';
import { loadBotConfig } from '@sniptail/core/config/config.js';
import { buildSlackIds } from '@sniptail/core/slack/ids.js';
import type { BootstrapRequest } from '@sniptail/core/types/bootstrap.js';
import type { JobSpec } from '@sniptail/core/types/job.js';
import type { WorkerEvent } from '@sniptail/core/types/worker-event.js';
import type { SlackHandlerContext } from './features/context.js';
import { registerSlackHandlers } from './handlers.js';

export function createSlackApp(
  queue: Queue<JobSpec>,
  bootstrapQueue: Queue<BootstrapRequest>,
  workerEventQueue: Queue<WorkerEvent>,
) {
  const config = loadBotConfig();
  if (!config.slack) {
    throw new Error(
      'Slack is not configured. Enable channels.slack in sniptail.bot.toml and set SLACK_* env vars.',
    );
  }
  const slackIds = buildSlackIds(config.botName);
  const app = new App({
    token: config.slack.botToken,
    appToken: config.slack.appToken,
    signingSecret: config.slack.signingSecret,
    socketMode: true,
  });

  const context: SlackHandlerContext = {
    app,
    slackIds,
    config,
    queue,
    bootstrapQueue,
    workerEventQueue,
  };

  registerSlackHandlers(context);

  return app;
}
