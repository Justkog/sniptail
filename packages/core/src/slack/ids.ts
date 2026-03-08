import { toSlackCommandPrefix } from '../utils/slack.js';

export type SlackIds = {
  commandPrefix: string;
  commands: {
    repoAdd: string;
    repoRemove: string;
    ask: string;
    explore: string;
    plan: string;
    implement: string;
    run: string;
    bootstrap: string;
    clearBefore: string;
    usage: string;
  };
  actions: {
    repoAddSubmit: string;
    repoRemoveSubmit: string;
    askFromJob: string;
    exploreFromJob: string;
    planFromJob: string;
    implementFromJob: string;
    runFromJob: string;
    reviewFromJob: string;
    worktreeCommands: string;
    clearJob: string;
    askSubmit: string;
    exploreSubmit: string;
    planSubmit: string;
    implementSubmit: string;
    runSubmit: string;
    bootstrapSubmit: string;
    runActionSelect: string;
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
      repoAdd: `/${commandPrefix}-repo-add`,
      repoRemove: `/${commandPrefix}-repo-remove`,
      ask: `/${commandPrefix}-ask`,
      explore: `/${commandPrefix}-explore`,
      plan: `/${commandPrefix}-plan`,
      implement: `/${commandPrefix}-implement`,
      run: `/${commandPrefix}-run`,
      bootstrap: `/${commandPrefix}-bootstrap`,
      clearBefore: `/${commandPrefix}-clear-before`,
      usage: `/${commandPrefix}-usage`,
    },
    actions: {
      repoAddSubmit: `${commandPrefix}-repo-add-submit`,
      repoRemoveSubmit: `${commandPrefix}-repo-remove-submit`,
      askFromJob: `${commandPrefix}-ask-from-job`,
      exploreFromJob: `${commandPrefix}-explore-from-job`,
      planFromJob: `${commandPrefix}-plan-from-job`,
      implementFromJob: `${commandPrefix}-implement-from-job`,
      runFromJob: `${commandPrefix}-run-from-job`,
      reviewFromJob: `${commandPrefix}-review-from-job`,
      worktreeCommands: `${commandPrefix}-worktree-commands`,
      clearJob: `${commandPrefix}-clear-job`,
      askSubmit: `${commandPrefix}-ask-submit`,
      exploreSubmit: `${commandPrefix}-explore-submit`,
      planSubmit: `${commandPrefix}-plan-submit`,
      implementSubmit: `${commandPrefix}-implement-submit`,
      runSubmit: `${commandPrefix}-run-submit`,
      bootstrapSubmit: `${commandPrefix}-bootstrap-submit`,
      runActionSelect: `${commandPrefix}-run-action-select`,
      answerQuestions: `${commandPrefix}-answer-questions`,
      answerQuestionsSubmit: `${commandPrefix}-answer-questions-submit`,
      approvalApprove: `${commandPrefix}-approval-approve`,
      approvalDeny: `${commandPrefix}-approval-deny`,
      approvalCancel: `${commandPrefix}-approval-cancel`,
    },
  };
}
