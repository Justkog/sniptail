import { randomUUID } from 'node:crypto';
import { LRUCache } from 'lru-cache';
import type {
  AgentSessionListFilters,
  AgentSessionSummary,
} from '@sniptail/core/agent-sessions/listing.js';
import type {
  InteractionCallbackResponse,
  ModalSubmitInteraction,
  StringSelectMenuInteraction,
} from 'discord.js';
import { logger } from '@sniptail/core/logger.js';
import type { DiscordContextAttachmentRef } from './lib/discordContextFiles.js';

type DiscordJobSelectionState = {
  repoKeys: string[];
  requestedAt: number;
  contextAttachments?: DiscordContextAttachmentRef[];
  resumeFromJobId?: string;
  selectorMessageId?: string;
};

type DiscordScopedJobSelectionState = DiscordJobSelectionState & {
  userId: string;
};

const FROM_JOB_SELECTION_MAX_ENTRIES = 50;
const DISCORD_STATE_MAX_ENTRIES = 1000;
export const DISCORD_SELECTION_TTL_MS = 15 * 60 * 1000;
export const DISCORD_SELECTION_CAPTURED_MESSAGE =
  'Repository selection captured. Complete the modal or rerun the command.';
export const DISCORD_AGENT_SESSIONS_STATE_TTL_MS = 15 * 60 * 1000;

function createDiscordStateCache<T extends object>(
  ttl: number,
  max = DISCORD_STATE_MAX_ENTRIES,
): LRUCache<string, T> {
  return new LRUCache<string, T>({
    max,
    ttl,
    perf: { now: () => Date.now() },
  });
}

export const askSelectionByUser =
  createDiscordStateCache<DiscordJobSelectionState>(DISCORD_SELECTION_TTL_MS);
export const exploreSelectionByUser =
  createDiscordStateCache<DiscordJobSelectionState>(DISCORD_SELECTION_TTL_MS);
export const planSelectionByUser =
  createDiscordStateCache<DiscordJobSelectionState>(DISCORD_SELECTION_TTL_MS);
export const askFromJobSelectionByToken = createDiscordStateCache<DiscordScopedJobSelectionState>(
  DISCORD_SELECTION_TTL_MS,
  FROM_JOB_SELECTION_MAX_ENTRIES,
);
export const exploreFromJobSelectionByToken =
  createDiscordStateCache<DiscordScopedJobSelectionState>(
    DISCORD_SELECTION_TTL_MS,
    FROM_JOB_SELECTION_MAX_ENTRIES,
  );
export const planFromJobSelectionByToken = createDiscordStateCache<DiscordScopedJobSelectionState>(
  DISCORD_SELECTION_TTL_MS,
  FROM_JOB_SELECTION_MAX_ENTRIES,
);
export const answerQuestionsByUser = createDiscordStateCache<{
  jobId: string;
  openQuestions: string[];
  requestedAt: number;
}>(DISCORD_SELECTION_TTL_MS);
export const implementSelectionByUser =
  createDiscordStateCache<DiscordJobSelectionState>(DISCORD_SELECTION_TTL_MS);
export const implementFromJobSelectionByToken =
  createDiscordStateCache<DiscordScopedJobSelectionState>(
    DISCORD_SELECTION_TTL_MS,
    FROM_JOB_SELECTION_MAX_ENTRIES,
  );
export const runSelectionByUser = createDiscordStateCache<{
  repoKeys: string[];
  resumeFromJobId?: string;
  actionId?: string;
  requestedAt: number;
  runStepIndex?: number;
  collectedParams?: Record<string, unknown>;
  gitRef?: string;
  selectorMessageId?: string;
}>(DISCORD_SELECTION_TTL_MS);
export const bootstrapExtrasByUser = createDiscordStateCache<{
  service: string;
  visibility: 'private' | 'public';
  quickstart: boolean;
  requestedAt: number;
}>(DISCORD_SELECTION_TTL_MS);

export type PendingDiscordAgentSessionBrowserRequest = {
  requestId: string;
  channelId: string;
  userId: string;
  guildId?: string;
  interactionApplicationId: string;
  interactionToken: string;
  workerId: string;
  agentProfileKey?: string;
  filters?: AgentSessionListFilters;
  currentCursor?: string;
  cursorHistory: string[];
  requestedAt: number;
};

export type DiscordAgentSessionsBrowserActionPayload = {
  channelId: string;
  userId: string;
  guildId?: string;
  workerId: string;
  agentProfileKey?: string;
  filters?: AgentSessionListFilters;
};

export type DiscordAgentSessionsPageActionPayload = DiscordAgentSessionsBrowserActionPayload & {
  currentCursor?: string;
  cursorHistory: string[];
  previousCursor?: string;
  nextCursor?: string;
};

export type DiscordAgentSessionsAttachActionPayload = DiscordAgentSessionsBrowserActionPayload & {
  provider: AgentSessionSummary['provider'];
  providerSessionId: string;
  sessionAgentProfileKey: string;
  workspaceKey?: string;
  cwd?: string;
  title?: string;
};

type DiscordAgentSessionsActionState =
  | {
      kind: 'previous' | 'next';
      payload: DiscordAgentSessionsPageActionPayload;
      requestedAt: number;
    }
  | { kind: 'attach'; payload: DiscordAgentSessionsAttachActionPayload; requestedAt: number };

const pendingDiscordAgentSessionBrowsers =
  createDiscordStateCache<PendingDiscordAgentSessionBrowserRequest>(
    DISCORD_AGENT_SESSIONS_STATE_TTL_MS,
  );
const discordAgentSessionsActionStateByToken =
  createDiscordStateCache<DiscordAgentSessionsActionState>(DISCORD_AGENT_SESSIONS_STATE_TTL_MS);

export function createDiscordSelectionToken(): string {
  return randomUUID();
}

export function setPendingDiscordAgentSessionBrowserRequest(
  payload: PendingDiscordAgentSessionBrowserRequest,
): void {
  pendingDiscordAgentSessionBrowsers.set(payload.requestId, payload);
}

export function getPendingDiscordAgentSessionBrowserRequest(
  requestId: string,
): PendingDiscordAgentSessionBrowserRequest | undefined {
  return pendingDiscordAgentSessionBrowsers.get(requestId);
}

export function clearPendingDiscordAgentSessionBrowserRequest(requestId: string): void {
  pendingDiscordAgentSessionBrowsers.delete(requestId);
}

export function setDiscordAgentSessionsActionState(
  state: Omit<DiscordAgentSessionsActionState, 'requestedAt'>,
): string {
  const token = randomUUID();
  discordAgentSessionsActionStateByToken.set(token, {
    ...state,
    requestedAt: Date.now(),
  } as DiscordAgentSessionsActionState);
  return token;
}

export function getDiscordAgentSessionsActionState(
  token: string,
): DiscordAgentSessionsActionState | undefined {
  return discordAgentSessionsActionStateByToken.get(token);
}

export function clearDiscordAgentSessionsActionState(token: string): void {
  discordAgentSessionsActionStateByToken.delete(token);
}

export function setFromJobSelectionWithCap(
  selectionMap: LRUCache<string, DiscordScopedJobSelectionState>,
  selectionToken: string,
  selection: DiscordScopedJobSelectionState,
): void {
  selectionMap.set(selectionToken, selection);
}

export function isSelectionExpired(
  selectionMap: LRUCache<string, DiscordJobSelectionState>,
  userId: string,
): boolean {
  const selection = selectionMap.get(userId, { allowStale: true });
  return Boolean(selection) && !selectionMap.has(userId);
}

export function getActiveDiscordSelection(
  selectionMap: LRUCache<string, DiscordJobSelectionState>,
  userId: string,
): {
  selection?: DiscordJobSelectionState;
  expiredSelection?: DiscordJobSelectionState;
} {
  const selection = selectionMap.get(userId, { allowStale: true });
  if (!selection) {
    return {};
  }

  if (!selectionMap.has(userId)) {
    return { expiredSelection: selection };
  }

  return { selection };
}

function captureSelectionReplyId<T extends DiscordJobSelectionState>(
  selectionMap: LRUCache<string, T>,
  key: string,
  loggingUserId: string,
  flow: string,
  response: Pick<InteractionCallbackResponse, 'resource'>,
): void {
  const selection = selectionMap.get(key);
  if (!selection) {
    return;
  }

  const selectorMessageId = response.resource?.message?.id;
  if (!selectorMessageId) {
    logger.warn(
      { flow, userId: loggingUserId },
      'Discord selector reply response did not include a message id',
    );
    return;
  }

  try {
    selectionMap.set(key, {
      ...selection,
      selectorMessageId,
    } as T);
  } catch (err) {
    logger.warn({ err, flow, userId: loggingUserId }, 'Failed to capture Discord selector reply');
  }
}

export function storeDiscordSelectionReplyId(
  interaction: { user: { id: string } },
  selectionMap: LRUCache<string, DiscordJobSelectionState>,
  flow: string,
  response: Pick<InteractionCallbackResponse, 'resource'>,
): void {
  captureSelectionReplyId(selectionMap, interaction.user.id, interaction.user.id, flow, response);
}

export function storeDiscordScopedSelectionReplyId(
  selectionMap: LRUCache<string, DiscordScopedJobSelectionState>,
  selectionToken: string,
  flow: string,
  response: Pick<InteractionCallbackResponse, 'resource'>,
): void {
  const selection = selectionMap.get(selectionToken);
  if (!selection) {
    return;
  }
  captureSelectionReplyId(selectionMap, selectionToken, selection.userId, flow, response);
}

export async function disableDiscordSelectionReply(
  interaction: StringSelectMenuInteraction | ModalSubmitInteraction,
  selection: DiscordJobSelectionState | undefined,
  content: string,
  flow: string,
): Promise<void> {
  const selectorMessageId = selection?.selectorMessageId;
  if (!selectorMessageId) {
    return;
  }

  const payload = {
    content,
    components: [],
  };

  try {
    await interaction.webhook.editMessage(selectorMessageId, payload);
  } catch (err) {
    logger.warn(
      { err, flow, userId: interaction.user.id, selectorMessageId },
      'Failed to disable Discord selector reply',
    );
  }
}

export async function deleteDiscordSelectionReply(
  interaction: StringSelectMenuInteraction | ModalSubmitInteraction,
  selection: DiscordJobSelectionState | undefined,
  flow: string,
): Promise<void> {
  const selectorMessageId = selection?.selectorMessageId;
  if (!selectorMessageId) {
    return;
  }

  try {
    await interaction.webhook.deleteMessage(selectorMessageId);
  } catch (err) {
    logger.warn(
      { err, flow, userId: interaction.user.id, selectorMessageId },
      'Failed to delete Discord selector reply',
    );
  }
}
