import type { CodedError } from '@slack/bolt';
import { logger } from '@sniptail/core/logger.js';
import { registerClearBeforeCommand } from './features/commands/clearBefore.js';
import { registerAskCommand } from './features/commands/ask.js';
import { registerPlanCommand } from './features/commands/plan.js';
import { registerBootstrapCommand } from './features/commands/bootstrap.js';
import { registerImplementCommand } from './features/commands/implement.js';
import { registerUsageCommand } from './features/commands/usage.js';
import { registerAskFromJobAction } from './features/actions/askFromJob.js';
import { registerPlanFromJobAction } from './features/actions/planFromJob.js';
import { registerClearJobAction } from './features/actions/clearJob.js';
import { registerAnswerQuestionsAction } from './features/actions/answerQuestions.js';
import { registerImplementFromJobAction } from './features/actions/implementFromJob.js';
import { registerReviewFromJobAction } from './features/actions/reviewFromJob.js';
import { registerWorktreeCommandsAction } from './features/actions/worktreeCommands.js';
import { registerAppMentionEvent } from './features/events/appMention.js';
import { registerAskSubmitView } from './features/views/askSubmit.js';
import { registerPlanSubmitView } from './features/views/planSubmit.js';
import { registerAnswerQuestionsSubmitView } from './features/views/answerQuestionsSubmit.js';
import { registerBootstrapSubmitView } from './features/views/bootstrapSubmit.js';
import { registerImplementSubmitView } from './features/views/implementSubmit.js';
import type { SlackHandlerContext } from './features/context.js';

export function registerSlackHandlers(context: SlackHandlerContext): void {
  registerAskCommand(context);
  registerPlanCommand(context);
  registerImplementCommand(context);
  registerBootstrapCommand(context);
  registerClearBeforeCommand(context);
  registerUsageCommand(context);
  registerAskFromJobAction(context);
  registerPlanFromJobAction(context);
  registerImplementFromJobAction(context);
  registerReviewFromJobAction(context);
  registerWorktreeCommandsAction(context);
  registerClearJobAction(context);
  registerAnswerQuestionsAction(context);
  registerAppMentionEvent(context);
  registerBootstrapSubmitView(context);
  registerAskSubmitView(context);
  registerPlanSubmitView(context);
  registerAnswerQuestionsSubmitView(context);
  registerImplementSubmitView(context);

  // eslint-disable-next-line @typescript-eslint/require-await
  context.app.error(async (err: CodedError) => {
    logger.error({ err }, 'Slack app error');
  });
}
