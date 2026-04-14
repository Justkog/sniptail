import { randomUUID } from 'node:crypto';
import type { DiscordContextAttachmentRef } from './lib/discordContextFiles.js';

type DiscordJobSelectionState = {
  repoKeys: string[];
  requestedAt: number;
  contextAttachments?: DiscordContextAttachmentRef[];
  resumeFromJobId?: string;
};

type DiscordScopedJobSelectionState = DiscordJobSelectionState & {
  userId: string;
};

const FROM_JOB_SELECTION_MAX_ENTRIES = 50;

export const askSelectionByUser = new Map<string, DiscordJobSelectionState>();
export const exploreSelectionByUser = new Map<string, DiscordJobSelectionState>();
export const planSelectionByUser = new Map<string, DiscordJobSelectionState>();
export const askFromJobSelectionByToken = new Map<string, DiscordScopedJobSelectionState>();
export const exploreFromJobSelectionByToken = new Map<string, DiscordScopedJobSelectionState>();
export const planFromJobSelectionByToken = new Map<string, DiscordScopedJobSelectionState>();
export const answerQuestionsByUser = new Map<
  string,
  { jobId: string; openQuestions: string[]; requestedAt: number }
>();
export const implementSelectionByUser = new Map<string, DiscordJobSelectionState>();
export const implementFromJobSelectionByToken = new Map<
  string,
  DiscordScopedJobSelectionState
>();
export const runSelectionByUser = new Map<
  string,
  {
    repoKeys: string[];
    actionId?: string;
    requestedAt: number;
    runStepIndex?: number;
    collectedParams?: Record<string, unknown>;
    gitRef?: string;
  }
>();
export const bootstrapExtrasByUser = new Map<
  string,
  {
    service: string;
    visibility: 'private' | 'public';
    quickstart: boolean;
    requestedAt: number;
  }
>();

export function createDiscordSelectionToken(): string {
  return randomUUID();
}

export function setFromJobSelectionWithCap(
  selectionMap: Map<string, DiscordScopedJobSelectionState>,
  selectionToken: string,
  selection: DiscordScopedJobSelectionState,
): void {
  if (!selectionMap.has(selectionToken) && selectionMap.size >= FROM_JOB_SELECTION_MAX_ENTRIES) {
    const oldestSelectionToken = selectionMap.keys().next().value;
    if (oldestSelectionToken) {
      selectionMap.delete(oldestSelectionToken);
    }
  }

  selectionMap.set(selectionToken, selection);
}
