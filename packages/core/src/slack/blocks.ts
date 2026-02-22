export type CompletionActionIds = {
  askFromJob: string;
  exploreFromJob: string;
  planFromJob: string;
  implementFromJob: string;
  runFromJob: string;
  reviewFromJob: string;
  worktreeCommands: string;
  clearJob: string;
  answerQuestions?: string;
};

export type CompletionBlockOptions = {
  includeAskFromJob?: boolean;
  includeExploreFromJob?: boolean;
  includePlanFromJob?: boolean;
  includeImplementFromJob?: boolean;
  includeRunFromJob?: boolean;
  includeReviewFromJob?: boolean;
  answerQuestionsFirst?: boolean;
};

export function buildCompletionBlocks(
  text: string,
  jobId: string,
  actionIds: CompletionActionIds,
  options?: CompletionBlockOptions,
) {
  const includeAskFromJob = options?.includeAskFromJob ?? true;
  const includeExploreFromJob = options?.includeExploreFromJob ?? true;
  const includePlanFromJob = options?.includePlanFromJob ?? true;
  const includeImplementFromJob = options?.includeImplementFromJob ?? true;
  const includeRunFromJob = options?.includeRunFromJob ?? true;
  const includeReviewFromJob = options?.includeReviewFromJob ?? false;
  const answerQuestionsFirst = options?.answerQuestionsFirst ?? false;
  const elements: Array<Record<string, unknown>> = [];

  if (answerQuestionsFirst && actionIds.answerQuestions) {
    elements.push({
      type: 'button' as const,
      text: { type: 'plain_text' as const, text: 'Answer questions' },
      action_id: actionIds.answerQuestions,
      value: jobId,
    });
  }
  if (includeAskFromJob) {
    elements.push({
      type: 'button' as const,
      text: { type: 'plain_text' as const, text: 'Ask' },
      action_id: actionIds.askFromJob,
      value: jobId,
    });
  }
  if (includeExploreFromJob) {
    elements.push({
      type: 'button' as const,
      text: { type: 'plain_text' as const, text: 'Explore' },
      action_id: actionIds.exploreFromJob,
      value: jobId,
    });
  }
  if (includePlanFromJob) {
    elements.push({
      type: 'button' as const,
      text: { type: 'plain_text' as const, text: 'Plan' },
      action_id: actionIds.planFromJob,
      value: jobId,
    });
  }
  if (includeImplementFromJob) {
    elements.push({
      type: 'button' as const,
      text: { type: 'plain_text' as const, text: 'Implement' },
      action_id: actionIds.implementFromJob,
      value: jobId,
    });
  }
  if (includeRunFromJob) {
    elements.push({
      type: 'button' as const,
      text: { type: 'plain_text' as const, text: 'Run' },
      action_id: actionIds.runFromJob,
      value: jobId,
    });
  }
  if (includeReviewFromJob) {
    elements.push({
      type: 'button' as const,
      text: { type: 'plain_text' as const, text: 'Review' },
      action_id: actionIds.reviewFromJob,
      value: jobId,
    });
  }
  elements.push({
    type: 'button' as const,
    text: { type: 'plain_text' as const, text: 'Take over' },
    action_id: actionIds.worktreeCommands,
    value: jobId,
  });
  if (!answerQuestionsFirst && actionIds.answerQuestions) {
    elements.push({
      type: 'button' as const,
      text: { type: 'plain_text' as const, text: 'Answer questions' },
      action_id: actionIds.answerQuestions,
      value: jobId,
    });
  }
  elements.push({
    type: 'button' as const,
    text: { type: 'plain_text' as const, text: 'Clear job data' },
    action_id: actionIds.clearJob,
    style: 'danger' as const,
    value: jobId,
    confirm: {
      title: { type: 'plain_text' as const, text: 'Clear job data?' },
      text: {
        type: 'mrkdwn' as const,
        text: 'This will remove the job data and worktree after 5 minutes.',
      },
      confirm: { type: 'plain_text' as const, text: 'Clear' },
      deny: { type: 'plain_text' as const, text: 'Cancel' },
    },
  });

  return [
    {
      type: 'section' as const,
      text: {
        type: 'mrkdwn' as const,
        text,
      },
    },
    {
      type: 'actions' as const,
      elements,
    },
  ];
}
