import { toSlackCommandPrefix } from '../utils/slack.js';

export type SlackIds = {
  commandPrefix: string;
  commands: {
    ask: string;
    plan: string;
    implement: string;
    bootstrap: string;
    clearBefore: string;
    usage: string;
  };
  actions: {
    askFromJob: string;
    implementFromJob: string;
    worktreeCommands: string;
    clearJob: string;
    askSubmit: string;
    planSubmit: string;
    implementSubmit: string;
    bootstrapSubmit: string;
    answerQuestions: string;
    answerQuestionsSubmit: string;
  };
};

export function buildSlackIds(botName: string): SlackIds {
  const commandPrefix = toSlackCommandPrefix(botName);

  return {
    commandPrefix,
    commands: {
      ask: `/${commandPrefix}-ask`,
      plan: `/${commandPrefix}-plan`,
      implement: `/${commandPrefix}-implement`,
      bootstrap: `/${commandPrefix}-bootstrap`,
      clearBefore: `/${commandPrefix}-clear-before`,
      usage: `/${commandPrefix}-usage`,
    },
    actions: {
      askFromJob: `${commandPrefix}-ask-from-job`,
      implementFromJob: `${commandPrefix}-implement-from-job`,
      worktreeCommands: `${commandPrefix}-worktree-commands`,
      clearJob: `${commandPrefix}-clear-job`,
      askSubmit: `${commandPrefix}-ask-submit`,
      planSubmit: `${commandPrefix}-plan-submit`,
      implementSubmit: `${commandPrefix}-implement-submit`,
      bootstrapSubmit: `${commandPrefix}-bootstrap-submit`,
      answerQuestions: `${commandPrefix}-answer-questions`,
      answerQuestionsSubmit: `${commandPrefix}-answer-questions-submit`,
    },
  };
}
