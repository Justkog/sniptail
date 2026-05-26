import type { JobType } from '@sniptail/core/types/job.js';
import { LRUCache } from 'lru-cache';

export type TelegramWizardState = {
  type: Extract<JobType, 'ASK' | 'EXPLORE' | 'PLAN' | 'IMPLEMENT' | 'REVIEW'>;
  step: 'request' | 'repos';
  promptMessageId: number;
  requestText?: string;
  startedAt: number;
};

const WIZARD_STATE_MAX_ENTRIES = 1000;
const WIZARD_TTL_MS = 15 * 60 * 1000;
const wizardState = new LRUCache<string, TelegramWizardState>({
  max: WIZARD_STATE_MAX_ENTRIES,
  ttl: WIZARD_TTL_MS,
  ttlAutopurge: true,
  perf: { now: () => Date.now() },
});

function makeKey(chatId: string, userId: string): string {
  return `${chatId}:${userId}`;
}

export function loadTelegramWizardState(
  chatId: string,
  userId: string,
): TelegramWizardState | undefined {
  const key = makeKey(chatId, userId);
  const state = wizardState.get(key);
  if (!state) {
    return undefined;
  }
  if (Date.now() - state.startedAt > WIZARD_TTL_MS) {
    wizardState.delete(key);
    return undefined;
  }
  return state;
}

export function saveTelegramWizardState(
  chatId: string,
  userId: string,
  state: TelegramWizardState,
): void {
  wizardState.set(makeKey(chatId, userId), state);
}

export function clearTelegramWizardState(chatId: string, userId: string): void {
  wizardState.delete(makeKey(chatId, userId));
}
