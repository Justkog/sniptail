export type DiscordCompletionAction =
  | 'askFromJob'
  | 'implementFromJob'
  | 'worktreeCommands'
  | 'answerQuestions'
  | 'clearJob'
  | 'clearJobConfirm'
  | 'clearJobCancel';

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

const actionTokens = {
  askFromJob: 'ask',
  implementFromJob: 'implement',
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
  [actionTokens.implementFromJob]: 'implementFromJob',
  [actionTokens.worktreeCommands]: 'worktreeCommands',
  [actionTokens.answerQuestions]: 'answerQuestions',
  [actionTokens.clearJob]: 'clearJob',
  [actionTokens.clearJobConfirm]: 'clearJobConfirm',
  [actionTokens.clearJobCancel]: 'clearJobCancel',
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

export function buildDiscordCompletionComponents(
  jobId: string,
  options?: { includeAnswerQuestions?: boolean },
): DiscordActionRow[] {
  const includeAnswerQuestions = options?.includeAnswerQuestions ?? false;
  return [
    {
      type: 1,
      components: [
        {
          type: 2,
          style: 1,
          label: 'Ask from there',
          custom_id: buildDiscordCompletionCustomId('askFromJob', jobId),
        },
        {
          type: 2,
          style: 1,
          label: 'Implement from there',
          custom_id: buildDiscordCompletionCustomId('implementFromJob', jobId),
        },
        {
          type: 2,
          style: 2,
          label: 'Take over',
          custom_id: buildDiscordCompletionCustomId('worktreeCommands', jobId),
        },
        ...(includeAnswerQuestions
          ? [
              {
                type: 2,
                style: 1,
                label: 'Answer questions',
                custom_id: buildDiscordCompletionCustomId('answerQuestions', jobId),
              } as const,
            ]
          : []),
        {
          type: 2,
          style: 4,
          label: 'Clear job data',
          custom_id: buildDiscordCompletionCustomId('clearJob', jobId),
        },
      ],
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
