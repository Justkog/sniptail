export type CompletionActionIds = {
  askFromJob: string;
  implementFromJob: string;
  worktreeCommands: string;
  clearJob: string;
  answerQuestions?: string;
};

export type CompletionBlockOptions = {
  includeAskFromJob?: boolean;
  includeImplementFromJob?: boolean;
  answerQuestionsFirst?: boolean;
};

export function buildCompletionBlocks(
  text: string,
  jobId: string,
  actionIds: CompletionActionIds,
  options?: CompletionBlockOptions,
) {
  const includeAskFromJob = options?.includeAskFromJob ?? true;
  const includeImplementFromJob = options?.includeImplementFromJob ?? true;
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
      text: { type: 'plain_text' as const, text: 'Ask from there' },
      action_id: actionIds.askFromJob,
      value: jobId,
    });
  }
  if (includeImplementFromJob) {
    elements.push({
      type: 'button' as const,
      text: { type: 'plain_text' as const, text: 'Implement from there' },
      action_id: actionIds.implementFromJob,
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
