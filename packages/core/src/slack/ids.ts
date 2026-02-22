import { toSlackCommandPrefix } from '../utils/slack.js';

export type SlackIds = {
  commandPrefix: string;
  commands: {
    ask: string;
    explore: string;
    plan: string;
    implement: string;
    bootstrap: string;
    clearBefore: string;
    usage: string;
  };
  actions: {
    askFromJob: string;
    exploreFromJob: string;
    planFromJob: string;
    implementFromJob: string;
    reviewFromJob: string;
    worktreeCommands: string;
    clearJob: string;
    askSubmit: string;
    exploreSubmit: string;
    planSubmit: string;
    implementSubmit: string;
    bootstrapSubmit: string;
    answerQuestions: string;
    answerQuestionsSubmit: string;
    approvalApprove: string;
    approvalDeny: string;
    approvalCancel: string;
  };
};

export function buildSlackIds(botName: string): SlackIds {
  const commandPrefix = toSlackCommandPrefix(botName);

  return {
    commandPrefix,
    commands: {
      ask: `/${commandPrefix}-ask`,
      explore: `/${commandPrefix}-explore`,
      plan: `/${commandPrefix}-plan`,
      implement: `/${commandPrefix}-implement`,
      bootstrap: `/${commandPrefix}-bootstrap`,
      clearBefore: `/${commandPrefix}-clear-before`,
      usage: `/${commandPrefix}-usage`,
    },
    actions: {
      askFromJob: `${commandPrefix}-ask-from-job`,
      exploreFromJob: `${commandPrefix}-explore-from-job`,
      planFromJob: `${commandPrefix}-plan-from-job`,
      implementFromJob: `${commandPrefix}-implement-from-job`,
      reviewFromJob: `${commandPrefix}-review-from-job`,
      worktreeCommands: `${commandPrefix}-worktree-commands`,
      clearJob: `${commandPrefix}-clear-job`,
      askSubmit: `${commandPrefix}-ask-submit`,
      exploreSubmit: `${commandPrefix}-explore-submit`,
      planSubmit: `${commandPrefix}-plan-submit`,
      implementSubmit: `${commandPrefix}-implement-submit`,
      bootstrapSubmit: `${commandPrefix}-bootstrap-submit`,
      answerQuestions: `${commandPrefix}-answer-questions`,
      answerQuestionsSubmit: `${commandPrefix}-answer-questions-submit`,
      approvalApprove: `${commandPrefix}-approval-approve`,
      approvalDeny: `${commandPrefix}-approval-deny`,
      approvalCancel: `${commandPrefix}-approval-cancel`,
    },
  };
}
