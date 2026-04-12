import type { JobType } from '@sniptail/core/types/job.js';

const TELEGRAM_JOB_LABELS: Record<Extract<JobType, 'ASK' | 'EXPLORE' | 'PLAN' | 'IMPLEMENT' | 'REVIEW'>, string> = {
  ASK: 'Ask',
  EXPLORE: 'Explore',
  PLAN: 'Plan',
  IMPLEMENT: 'Implement',
  REVIEW: 'Review',
};

export function buildTelegramHelpText(botName: string): string {
  return [
    `${botName} Telegram commands`,
    '/usage',
    '/ask <repo[,repo]> | <question>',
    '/explore <repo[,repo]> | <request>',
    '/plan <repo[,repo]> | <request>',
    '/implement <repo[,repo]> | <request>',
    '/review <repo[,repo]> | <request>',
    '/run <repo[,repo]> | <action-id> | <key=value,key2=value2>',
    '',
    'If you omit arguments for ask/explore/plan/implement/review, Sniptail will guide you with edited messages and inline controls.',
  ].join('\n');
}

type TelegramInlineKeyboard = {
  inline_keyboard: Array<Array<{ text: string; callback_data: string }>>;
};

export function buildTelegramCancelKeyboard(action = 'cancel'): TelegramInlineKeyboard {
  return {
    inline_keyboard: [[{ text: 'Cancel', callback_data: action }]],
  };
}

export function buildTelegramApprovalKeyboard(approvalId: string): TelegramInlineKeyboard {
  return {
    inline_keyboard: [
      [
        { text: 'Approve', callback_data: `approval:grant:${approvalId}` },
        { text: 'Deny', callback_data: `approval:deny:${approvalId}` },
      ],
      [{ text: 'Cancel', callback_data: `approval:cancel:${approvalId}` }],
    ],
  };
}

export function buildTelegramRepoSelectionKeyboard(
  repoKeys: string[],
): TelegramInlineKeyboard | undefined {
  if (!repoKeys.length || repoKeys.length > 6) {
    return undefined;
  }
  return {
    inline_keyboard: [
      ...repoKeys.map((repoKey) => [{ text: repoKey, callback_data: `repo:${repoKey}` }]),
      [{ text: 'Cancel', callback_data: 'cancel' }],
    ],
  };
}

export function buildTelegramWizardPrompt(
  type: Extract<JobType, 'ASK' | 'EXPLORE' | 'PLAN' | 'IMPLEMENT' | 'REVIEW'>,
  step: 'request' | 'repos',
  requestText?: string,
): string {
  const label = TELEGRAM_JOB_LABELS[type];
  if (step === 'request') {
    return `${label}: send the request text in your next message.`;
  }
  return [
    `${label}: request captured.`,
    `Request: ${requestText ?? '(missing)'}`,
    'Now send repo keys as comma-separated text, or tap a repo button if shown.',
  ].join('\n');
}

export function buildTelegramWizardExpiredText(): string {
  return 'This Telegram interaction expired. Start the command again.';
}

export function buildTelegramAcceptedText(jobId: string, type: JobType): string {
  return `Accepted ${type.toLowerCase()} job ${jobId}. I will report back here.`;
}

export function parseRepoAndRequestInput(raw: string): { repoKeys: string[]; requestText: string } | undefined {
  const [reposRaw, ...requestParts] = raw.split('|');
  if (!reposRaw) {
    return undefined;
  }
  const requestText = requestParts.join('|').trim();
  const repoKeys = reposRaw
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  if (!repoKeys.length || !requestText) {
    return undefined;
  }
  return { repoKeys, requestText };
}

export function parseRunInput(raw: string): {
  repoKeys: string[];
  actionId: string;
  params?: Record<string, string>;
} | undefined {
  const parts = raw.split('|').map((value) => value.trim());
  if (parts.length < 2) {
    return undefined;
  }
  const reposRaw = parts[0];
  const actionId = parts[1];
  if (!reposRaw || !actionId) {
    return undefined;
  }
  const repoKeys = reposRaw
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  if (!repoKeys.length) {
    return undefined;
  }
  if (!parts[2]) {
    return { repoKeys, actionId };
  }
  const params = parts[2]
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .reduce<Record<string, string>>((acc, entry) => {
      const [key, ...valueParts] = entry.split('=');
      const value = valueParts.join('=').trim();
      if (key?.trim() && value) {
        acc[key.trim()] = value;
      }
      return acc;
    }, {});
  return {
    repoKeys,
    actionId,
    ...(Object.keys(params).length ? { params } : {}),
  };
}
