import { App, type CodedError } from '@slack/bolt';
import type { Queue } from 'bullmq';
import { loadBotConfig } from '@sniptail/core/config/index.js';
import { logger } from '@sniptail/core/logger.js';
import { buildSlackIds } from '@sniptail/core/slack/ids.js';
import type { BootstrapRequest } from '@sniptail/core/types/bootstrap.js';
import type { JobSpec } from '@sniptail/core/types/job.js';
import { registerClearBeforeCommand } from './features/commands/clearBefore.js';
import { registerAskCommand } from './features/commands/ask.js';
import { registerBootstrapCommand } from './features/commands/bootstrap.js';
import { registerImplementCommand } from './features/commands/implement.js';
import { registerUsageCommand } from './features/commands/usage.js';
import { registerAskFromJobAction } from './features/actions/askFromJob.js';
import { registerClearJobAction } from './features/actions/clearJob.js';
import { registerImplementFromJobAction } from './features/actions/implementFromJob.js';
import { registerWorktreeCommandsAction } from './features/actions/worktreeCommands.js';
import { registerAppMentionEvent } from './features/events/appMention.js';
import { registerAskSubmitView } from './features/views/askSubmit.js';
import { registerBootstrapSubmitView } from './features/views/bootstrapSubmit.js';
import { registerImplementSubmitView } from './features/views/implementSubmit.js';

export function createSlackApp(
  queue: Queue<JobSpec>,
  bootstrapQueue: Queue<BootstrapRequest>,
) {
  const config = loadBotConfig();
  const slackIds = buildSlackIds(config.botName);
  const app = new App({
    token: config.slack.botToken,
    appToken: config.slack.appToken,
    signingSecret: config.slack.signingSecret,
    socketMode: true,
  });

  const context = {
    app,
    slackIds,
    config,
    queue,
    bootstrapQueue,
  };

  registerAskCommand(context);
  registerImplementCommand(context);
  registerBootstrapCommand(context);
  registerClearBeforeCommand(context);
  registerUsageCommand(context);
  registerAskFromJobAction(context);
  registerImplementFromJobAction(context);
  registerWorktreeCommandsAction(context);
  registerClearJobAction(context);
  registerAppMentionEvent(context);
  registerBootstrapSubmitView(context);
  registerAskSubmitView(context);
  registerImplementSubmitView(context);

  // eslint-disable-next-line @typescript-eslint/require-await
  app.error(async (err: CodedError) => {
    logger.error({ err }, 'Slack app error');
  });

  return app;
}
