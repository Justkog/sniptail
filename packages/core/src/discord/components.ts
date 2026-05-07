export type DiscordCompletionAction =
  | 'askFromJob'
  | 'exploreFromJob'
  | 'planFromJob'
  | 'implementFromJob'
  | 'runFromJob'
  | 'reviewFromJob'
  | 'worktreeCommands'
  | 'answerQuestions'
  | 'clearJob'
  | 'clearJobConfirm'
  | 'clearJobCancel';

export type DiscordApprovalAction = 'approvalApprove' | 'approvalDeny' | 'approvalCancel';
export type DiscordAgentPermissionDecision = 'once' | 'always' | 'reject';
export type DiscordAgentQuestionAction = 'custom' | 'submit' | 'reject';
export type DiscordAgentFollowUpAction = 'queue' | 'steer';

type DiscordActionRow = {
  type: 1;
  components: Array<{
    type: 2;
    style: 1 | 2 | 4;
    label: string;
    custom_id: string;
  }>;
};

type DiscordSelectActionRow = {
  type: 1;
  components: Array<{
    type: 3;
    custom_id: string;
    placeholder: string;
    min_values: number;
    max_values: number;
    options: Array<{
      label: string;
      value: string;
      description?: string;
    }>;
  }>;
};

type DiscordQuestionComponentRow = DiscordActionRow | DiscordSelectActionRow;

const completionPrefix = 'sniptail:completion';
const approvalPrefix = 'sniptail:approval';
const agentPrefix = 'sniptail:agent';

const actionTokens = {
  askFromJob: 'ask',
  exploreFromJob: 'explore',
  planFromJob: 'plan',
  implementFromJob: 'implement',
  runFromJob: 'run',
  reviewFromJob: 'review',
  worktreeCommands: 'worktree',
  answerQuestions: 'answer-questions',
  clearJob: 'clear',
  clearJobConfirm: 'clear-confirm',
  clearJobCancel: 'clear-cancel',
} as const;

const tokenToAction: Record<
  (typeof actionTokens)[DiscordCompletionAction],
  DiscordCompletionAction
> = {
  [actionTokens.askFromJob]: 'askFromJob',
  [actionTokens.exploreFromJob]: 'exploreFromJob',
  [actionTokens.planFromJob]: 'planFromJob',
  [actionTokens.implementFromJob]: 'implementFromJob',
  [actionTokens.runFromJob]: 'runFromJob',
  [actionTokens.reviewFromJob]: 'reviewFromJob',
  [actionTokens.worktreeCommands]: 'worktreeCommands',
  [actionTokens.answerQuestions]: 'answerQuestions',
  [actionTokens.clearJob]: 'clearJob',
  [actionTokens.clearJobConfirm]: 'clearJobConfirm',
  [actionTokens.clearJobCancel]: 'clearJobCancel',
};

const approvalActionTokens = {
  approvalApprove: 'approve',
  approvalDeny: 'deny',
  approvalCancel: 'cancel',
} as const;

const approvalTokenToAction: Record<
  (typeof approvalActionTokens)[DiscordApprovalAction],
  DiscordApprovalAction
> = {
  [approvalActionTokens.approvalApprove]: 'approvalApprove',
  [approvalActionTokens.approvalDeny]: 'approvalDeny',
  [approvalActionTokens.approvalCancel]: 'approvalCancel',
};

export function buildDiscordCompletionCustomId(action: DiscordCompletionAction, jobId: string) {
  return `${completionPrefix}:${actionTokens[action]}:${jobId}`;
}

export function parseDiscordCompletionCustomId(
  customId: string,
): { action: DiscordCompletionAction; jobId: string } | undefined {
  if (!customId.startsWith(`${completionPrefix}:`)) return undefined;
  const parts = customId.split(':');
  if (parts.length < 4) return undefined;
  const actionToken = parts[2] as (typeof actionTokens)[DiscordCompletionAction];
  const jobId = parts.slice(3).join(':').trim();
  if (!jobId) return undefined;
  const action = tokenToAction[actionToken];
  if (!action) return undefined;
  return { action, jobId };
}

export function buildDiscordApprovalCustomId(action: DiscordApprovalAction, approvalId: string) {
  return `${approvalPrefix}:${approvalActionTokens[action]}:${approvalId}`;
}

export function parseDiscordApprovalCustomId(
  customId: string,
): { action: DiscordApprovalAction; approvalId: string } | undefined {
  if (!customId.startsWith(`${approvalPrefix}:`)) return undefined;
  const parts = customId.split(':');
  if (parts.length < 4) return undefined;
  const actionToken = parts[2] as (typeof approvalActionTokens)[DiscordApprovalAction];
  const approvalId = parts.slice(3).join(':').trim();
  if (!approvalId) return undefined;
  const action = approvalTokenToAction[actionToken];
  if (!action) return undefined;
  return { action, approvalId };
}

export function buildDiscordAgentStopCustomId(sessionId: string) {
  return `${agentPrefix}:stop:${sessionId}`;
}

export function parseDiscordAgentStopCustomId(customId: string): { sessionId: string } | undefined {
  if (!customId.startsWith(`${agentPrefix}:stop:`)) return undefined;
  const sessionId = customId.slice(`${agentPrefix}:stop:`.length).trim();
  if (!sessionId) return undefined;
  return { sessionId };
}

export function buildDiscordAgentStopComponents(sessionId: string): DiscordActionRow[] {
  return [
    {
      type: 1,
      components: [
        {
          type: 2,
          style: 4,
          label: 'Stop',
          custom_id: buildDiscordAgentStopCustomId(sessionId),
        },
      ],
    },
  ];
}

export function buildDiscordAgentFollowUpCustomId(
  action: DiscordAgentFollowUpAction,
  sessionId: string,
  messageId: string,
) {
  return `${agentPrefix}:follow:${action}:${sessionId}:${messageId}`;
}

export function parseDiscordAgentFollowUpCustomId(customId: string):
  | {
      action: DiscordAgentFollowUpAction;
      sessionId: string;
      messageId: string;
    }
  | undefined {
  if (!customId.startsWith(`${agentPrefix}:follow:`)) return undefined;
  const parts = customId.split(':');
  if (parts.length < 6) return undefined;
  const action = parts[3] as DiscordAgentFollowUpAction;
  if (action !== 'queue' && action !== 'steer') return undefined;
  const sessionId = parts[4]?.trim();
  const messageId = parts.slice(5).join(':').trim();
  if (!sessionId || !messageId) return undefined;
  return { action, sessionId, messageId };
}

export function buildDiscordAgentFollowUpBusyComponents(
  sessionId: string,
  messageId: string,
): DiscordActionRow[] {
  return [
    {
      type: 1,
      components: [
        {
          type: 2,
          style: 1,
          label: 'Queue',
          custom_id: buildDiscordAgentFollowUpCustomId('queue', sessionId, messageId),
        },
        {
          type: 2,
          style: 4,
          label: 'Steer',
          custom_id: buildDiscordAgentFollowUpCustomId('steer', sessionId, messageId),
        },
      ],
    },
  ];
}

export function buildDiscordAgentPermissionCustomId(
  decision: DiscordAgentPermissionDecision,
  sessionId: string,
  interactionId: string,
) {
  return `${agentPrefix}:perm:${decision}:${sessionId}:${interactionId}`;
}

export function parseDiscordAgentPermissionCustomId(customId: string):
  | {
      decision: DiscordAgentPermissionDecision;
      sessionId: string;
      interactionId: string;
    }
  | undefined {
  if (!customId.startsWith(`${agentPrefix}:perm:`)) return undefined;
  const parts = customId.split(':');
  if (parts.length < 6) return undefined;
  const decision = parts[3] as DiscordAgentPermissionDecision;
  if (decision !== 'once' && decision !== 'always' && decision !== 'reject') return undefined;
  const sessionId = parts[4]?.trim();
  const interactionId = parts.slice(5).join(':').trim();
  if (!sessionId || !interactionId) return undefined;
  return { decision, sessionId, interactionId };
}

export function buildDiscordAgentPermissionComponents(
  sessionId: string,
  interactionId: string,
  options?: { allowAlways?: boolean },
): DiscordActionRow[] {
  const components: DiscordActionRow['components'] = [
    {
      type: 2,
      style: 1,
      label: 'Approve once',
      custom_id: buildDiscordAgentPermissionCustomId('once', sessionId, interactionId),
    },
  ];
  if (options?.allowAlways ?? false) {
    components.push({
      type: 2,
      style: 2,
      label: 'Always allow',
      custom_id: buildDiscordAgentPermissionCustomId('always', sessionId, interactionId),
    });
  }
  components.push(
    {
      type: 2,
      style: 4,
      label: 'Reject',
      custom_id: buildDiscordAgentPermissionCustomId('reject', sessionId, interactionId),
    },
    {
      type: 2,
      style: 4,
      label: 'Stop session',
      custom_id: buildDiscordAgentStopCustomId(sessionId),
    },
  );
  return [{ type: 1, components }];
}

export function buildDiscordAgentQuestionSelectCustomId(
  questionIndex: number,
  sessionId: string,
  interactionId: string,
) {
  return `${agentPrefix}:qsel:${questionIndex}:${sessionId}:${interactionId}`;
}

export function parseDiscordAgentQuestionSelectCustomId(customId: string):
  | {
      questionIndex: number;
      sessionId: string;
      interactionId: string;
    }
  | undefined {
  if (!customId.startsWith(`${agentPrefix}:qsel:`)) return undefined;
  const parts = customId.split(':');
  if (parts.length < 6) return undefined;
  const questionIndex = Number.parseInt(parts[3] ?? '', 10);
  const sessionId = parts[4]?.trim();
  const interactionId = parts.slice(5).join(':').trim();
  if (!Number.isInteger(questionIndex) || questionIndex < 0 || !sessionId || !interactionId) {
    return undefined;
  }
  return { questionIndex, sessionId, interactionId };
}

export function buildDiscordAgentQuestionActionCustomId(
  action: DiscordAgentQuestionAction,
  sessionId: string,
  interactionId: string,
) {
  return `${agentPrefix}:qact:${action}:${sessionId}:${interactionId}`;
}

export function parseDiscordAgentQuestionActionCustomId(customId: string):
  | {
      action: DiscordAgentQuestionAction;
      sessionId: string;
      interactionId: string;
    }
  | undefined {
  if (!customId.startsWith(`${agentPrefix}:qact:`)) return undefined;
  const parts = customId.split(':');
  if (parts.length < 6) return undefined;
  const action = parts[3] as DiscordAgentQuestionAction;
  if (action !== 'custom' && action !== 'submit' && action !== 'reject') return undefined;
  const sessionId = parts[4]?.trim();
  const interactionId = parts.slice(5).join(':').trim();
  if (!sessionId || !interactionId) return undefined;
  return { action, sessionId, interactionId };
}

export function buildDiscordAgentQuestionModalCustomId(sessionId: string, interactionId: string) {
  return `${agentPrefix}:qmodal:${sessionId}:${interactionId}`;
}

export function parseDiscordAgentQuestionModalCustomId(customId: string):
  | {
      sessionId: string;
      interactionId: string;
    }
  | undefined {
  if (!customId.startsWith(`${agentPrefix}:qmodal:`)) return undefined;
  const parts = customId.split(':');
  if (parts.length < 5) return undefined;
  const sessionId = parts[3]?.trim();
  const interactionId = parts.slice(4).join(':').trim();
  if (!sessionId || !interactionId) return undefined;
  return { sessionId, interactionId };
}

export function buildDiscordAgentQuestionTextInputCustomId(questionIndex: number) {
  return `qtext:${questionIndex}`;
}

export function parseDiscordAgentQuestionTextInputCustomId(customId: string): number | undefined {
  if (!customId.startsWith('qtext:')) return undefined;
  const questionIndex = Number.parseInt(customId.slice('qtext:'.length), 10);
  if (!Number.isInteger(questionIndex) || questionIndex < 0) return undefined;
  return questionIndex;
}

export function buildDiscordAgentQuestionComponents(
  sessionId: string,
  interactionId: string,
  questions: Array<{
    header?: string;
    options: Array<{ label: string; description?: string }>;
    multiple: boolean;
    custom: boolean;
  }>,
): DiscordQuestionComponentRow[] {
  const rows: DiscordQuestionComponentRow[] = [];
  const selectableQuestions = questions.slice(0, 4);
  selectableQuestions.forEach((question, questionIndex) => {
    if (!question.options.length) return;
    const options = question.options.slice(0, 25).map((option, optionIndex) => ({
      label: option.label.slice(0, 100),
      value: String(optionIndex),
      ...(option.description ? { description: option.description.slice(0, 100) } : {}),
    }));
    rows.push({
      type: 1,
      components: [
        {
          type: 3,
          custom_id: buildDiscordAgentQuestionSelectCustomId(
            questionIndex,
            sessionId,
            interactionId,
          ),
          placeholder: (question.header?.trim() || `Question ${questionIndex + 1}`).slice(0, 100),
          min_values: question.multiple ? 0 : 1,
          max_values: question.multiple ? Math.max(1, options.length) : 1,
          options,
        },
      ],
    });
  });

  const controls: DiscordActionRow['components'] = [];
  if (questions.some((question) => question.custom)) {
    controls.push({
      type: 2,
      style: 1,
      label: 'Answer with text',
      custom_id: buildDiscordAgentQuestionActionCustomId('custom', sessionId, interactionId),
    });
  }
  if (questions.length > 1) {
    controls.push({
      type: 2,
      style: 1,
      label: 'Submit answers',
      custom_id: buildDiscordAgentQuestionActionCustomId('submit', sessionId, interactionId),
    });
  }
  controls.push(
    {
      type: 2,
      style: 4,
      label: 'Reject',
      custom_id: buildDiscordAgentQuestionActionCustomId('reject', sessionId, interactionId),
    },
    {
      type: 2,
      style: 4,
      label: 'Stop session',
      custom_id: buildDiscordAgentStopCustomId(sessionId),
    },
  );
  rows.push({ type: 1, components: controls });
  return rows;
}

export function buildDiscordCompletionComponents(
  jobId: string,
  options?: {
    includeAnswerQuestions?: boolean;
    includeAskFromJob?: boolean;
    includeExploreFromJob?: boolean;
    includePlanFromJob?: boolean;
    includeImplementFromJob?: boolean;
    includeRunFromJob?: boolean;
    includeReviewFromJob?: boolean;
    answerQuestionsFirst?: boolean;
  },
): DiscordActionRow[] {
  const includeAnswerQuestions = options?.includeAnswerQuestions ?? false;
  const includeAskFromJob = options?.includeAskFromJob ?? true;
  const includeExploreFromJob = options?.includeExploreFromJob ?? true;
  const includePlanFromJob = options?.includePlanFromJob ?? true;
  const includeImplementFromJob = options?.includeImplementFromJob ?? true;
  const includeRunFromJob = options?.includeRunFromJob ?? true;
  const includeReviewFromJob = options?.includeReviewFromJob ?? false;
  const answerQuestionsFirst = options?.answerQuestionsFirst ?? false;
  const components: DiscordActionRow['components'] = [];
  const secondaryRow: DiscordActionRow['components'] = [];
  if (answerQuestionsFirst && includeAnswerQuestions) {
    components.push({
      type: 2,
      style: 1,
      label: 'Answer questions',
      custom_id: buildDiscordCompletionCustomId('answerQuestions', jobId),
    });
  }
  if (includeAskFromJob) {
    components.push({
      type: 2,
      style: 1,
      label: 'Ask',
      custom_id: buildDiscordCompletionCustomId('askFromJob', jobId),
    });
  }
  if (includeExploreFromJob) {
    components.push({
      type: 2,
      style: 1,
      label: 'Explore',
      custom_id: buildDiscordCompletionCustomId('exploreFromJob', jobId),
    });
  }
  if (includePlanFromJob) {
    components.push({
      type: 2,
      style: 1,
      label: 'Plan',
      custom_id: buildDiscordCompletionCustomId('planFromJob', jobId),
    });
  }
  if (includeImplementFromJob) {
    components.push({
      type: 2,
      style: 1,
      label: 'Implement',
      custom_id: buildDiscordCompletionCustomId('implementFromJob', jobId),
    });
  }
  if (includeReviewFromJob) {
    secondaryRow.push({
      type: 2,
      style: 1,
      label: 'Review',
      custom_id: buildDiscordCompletionCustomId('reviewFromJob', jobId),
    });
  } else if (includeRunFromJob) {
    components.push({
      type: 2,
      style: 1,
      label: 'Run',
      custom_id: buildDiscordCompletionCustomId('runFromJob', jobId),
    });
  }
  if (includeReviewFromJob && includeRunFromJob) {
    secondaryRow.push({
      type: 2,
      style: 1,
      label: 'Run',
      custom_id: buildDiscordCompletionCustomId('runFromJob', jobId),
    });
  }
  secondaryRow.push({
    type: 2,
    style: 2,
    label: 'Take over',
    custom_id: buildDiscordCompletionCustomId('worktreeCommands', jobId),
  });
  if (!answerQuestionsFirst && includeAnswerQuestions) {
    secondaryRow.push({
      type: 2,
      style: 1,
      label: 'Answer questions',
      custom_id: buildDiscordCompletionCustomId('answerQuestions', jobId),
    });
  }
  secondaryRow.push({
    type: 2,
    style: 4,
    label: 'Clear job data',
    custom_id: buildDiscordCompletionCustomId('clearJob', jobId),
  });
  if (includeReviewFromJob) {
    if (components.length === 0) {
      return chunkComponents(secondaryRow);
    }
    return [{ type: 1, components }, ...chunkComponents(secondaryRow)];
  }
  return chunkComponents([...components, ...secondaryRow]);
}

function chunkComponents(
  components: DiscordActionRow['components'],
  maxPerRow = 5,
): DiscordActionRow[] {
  if (maxPerRow < 1) {
    return [{ type: 1, components }];
  }
  const rows: DiscordActionRow[] = [];
  for (let offset = 0; offset < components.length; offset += maxPerRow) {
    rows.push({
      type: 1,
      components: components.slice(offset, offset + maxPerRow),
    });
  }
  return rows;
}

export function buildDiscordClearJobConfirmComponents(jobId: string): DiscordActionRow[] {
  return [
    {
      type: 1,
      components: [
        {
          type: 2,
          style: 4,
          label: 'Clear job data',
          custom_id: buildDiscordCompletionCustomId('clearJobConfirm', jobId),
        },
        {
          type: 2,
          style: 2,
          label: 'Cancel',
          custom_id: buildDiscordCompletionCustomId('clearJobCancel', jobId),
        },
      ],
    },
  ];
}

export function buildDiscordApprovalComponents(approvalId: string): DiscordActionRow[] {
  return [
    {
      type: 1,
      components: [
        {
          type: 2,
          style: 1,
          label: 'Approve',
          custom_id: buildDiscordApprovalCustomId('approvalApprove', approvalId),
        },
        {
          type: 2,
          style: 4,
          label: 'Deny',
          custom_id: buildDiscordApprovalCustomId('approvalDeny', approvalId),
        },
        {
          type: 2,
          style: 2,
          label: 'Cancel',
          custom_id: buildDiscordApprovalCustomId('approvalCancel', approvalId),
        },
      ],
    },
  ];
}
