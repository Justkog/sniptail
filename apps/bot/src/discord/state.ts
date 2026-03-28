import type { DiscordContextAttachmentRef } from './lib/discordContextFiles.js';

type DiscordJobSelectionState = {
  repoKeys: string[];
  requestedAt: number;
  contextAttachments?: DiscordContextAttachmentRef[];
};

export const askSelectionByUser = new Map<string, DiscordJobSelectionState>();
export const exploreSelectionByUser = new Map<string, DiscordJobSelectionState>();
export const planSelectionByUser = new Map<string, DiscordJobSelectionState>();
export const answerQuestionsByUser = new Map<
  string,
  { jobId: string; openQuestions: string[]; requestedAt: number }
>();
export const implementSelectionByUser = new Map<string, DiscordJobSelectionState>();
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
