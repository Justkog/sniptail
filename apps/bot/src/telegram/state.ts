import type { JobType } from '@sniptail/core/types/job.js';

export type TelegramWizardState = {
  type: Extract<JobType, 'ASK' | 'EXPLORE' | 'PLAN' | 'IMPLEMENT' | 'REVIEW'>;
  step: 'request' | 'repos';
  promptMessageId: number;
  requestText?: string;
  startedAt: number;
};

const wizardState = new Map<string, TelegramWizardState>();
const WIZARD_TTL_MS = 15 * 60 * 1000;
const WIZARD_CLEANUP_INTERVAL_MS = 60 * 1000;

function makeKey(chatId: string, userId: string): string {
  return `${chatId}:${userId}`;
}

function isExpired(state: TelegramWizardState, now: number = Date.now()): boolean {
  return now - state.startedAt > WIZARD_TTL_MS;
}

function cleanupExpiredWizardState(): void {
  const now = Date.now();
  for (const [key, state] of wizardState.entries()) {
    if (isExpired(state, now)) {
      wizardState.delete(key);
    }
  }
}

const wizardStateCleanupTimer = setInterval(cleanupExpiredWizardState, WIZARD_CLEANUP_INTERVAL_MS);
wizardStateCleanupTimer.unref?.();

export function loadTelegramWizardState(chatId: string, userId: string): TelegramWizardState | undefined {
  const key = makeKey(chatId, userId);
  const state = wizardState.get(key);
  if (!state) {
    return undefined;
  }
  if (isExpired(state)) {
    wizardState.delete(key);
    return undefined;
  }
  return state;
}

export function saveTelegramWizardState(chatId: string, userId: string, state: TelegramWizardState): void {
  wizardState.set(makeKey(chatId, userId), state);
}

export function clearTelegramWizardState(chatId: string, userId: string): void {
  wizardState.delete(makeKey(chatId, userId));
}
