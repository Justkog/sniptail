export type DiscordCompletionAction =
  | 'askFromJob'
  | 'planFromJob'
  | 'implementFromJob'
  | 'reviewFromJob'
  | 'worktreeCommands'
  | 'answerQuestions'
  | 'clearJob'
  | 'clearJobConfirm'
  | 'clearJobCancel';

export type DiscordApprovalAction = 'approvalApprove' | 'approvalDeny' | 'approvalCancel';

type DiscordActionRow = {
  type: 1;
  components: Array<{
    type: 2;
    style: 1 | 2 | 4;
    label: string;
    custom_id: string;
  }>;
};

const completionPrefix = 'sniptail:completion';
const approvalPrefix = 'sniptail:approval';

const actionTokens = {
  askFromJob: 'ask',
  planFromJob: 'plan',
  implementFromJob: 'implement',
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
  [actionTokens.planFromJob]: 'planFromJob',
  [actionTokens.implementFromJob]: 'implementFromJob',
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

export function buildDiscordCompletionComponents(
  jobId: string,
  options?: {
    includeAnswerQuestions?: boolean;
    includeAskFromJob?: boolean;
    includePlanFromJob?: boolean;
    includeImplementFromJob?: boolean;
    includeReviewFromJob?: boolean;
    answerQuestionsFirst?: boolean;
  },
): DiscordActionRow[] {
  const includeAnswerQuestions = options?.includeAnswerQuestions ?? false;
  const includeAskFromJob = options?.includeAskFromJob ?? true;
  const includePlanFromJob = options?.includePlanFromJob ?? true;
  const includeImplementFromJob = options?.includeImplementFromJob ?? true;
  const includeReviewFromJob = options?.includeReviewFromJob ?? false;
  const answerQuestionsFirst = options?.answerQuestionsFirst ?? false;
  const components: DiscordActionRow['components'] = [];
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
    components.push({
      type: 2,
      style: 1,
      label: 'Review',
      custom_id: buildDiscordCompletionCustomId('reviewFromJob', jobId),
    });
  }
  components.push({
    type: 2,
    style: 2,
    label: 'Take over',
    custom_id: buildDiscordCompletionCustomId('worktreeCommands', jobId),
  });
  if (!answerQuestionsFirst && includeAnswerQuestions) {
    components.push({
      type: 2,
      style: 1,
      label: 'Answer questions',
      custom_id: buildDiscordCompletionCustomId('answerQuestions', jobId),
    });
  }
  components.push({
    type: 2,
    style: 4,
    label: 'Clear job data',
    custom_id: buildDiscordCompletionCustomId('clearJob', jobId),
  });
  return [
    {
      type: 1,
      components,
    },
  ];
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
