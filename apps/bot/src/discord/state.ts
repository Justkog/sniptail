import { randomUUID } from 'node:crypto';
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
export const DISCORD_SELECTION_TTL_MS = 15 * 60 * 1000;
export const DISCORD_SELECTION_CAPTURED_MESSAGE =
  'Repository selection captured. Complete the modal or rerun the command.';
export const DISCORD_AGENT_SESSIONS_STATE_TTL_MS = 15 * 60 * 1000;

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
export const implementFromJobSelectionByToken = new Map<string, DiscordScopedJobSelectionState>();
export const runSelectionByUser = new Map<
  string,
  {
    repoKeys: string[];
    resumeFromJobId?: string;
    actionId?: string;
    requestedAt: number;
    runStepIndex?: number;
    collectedParams?: Record<string, unknown>;
    gitRef?: string;
    selectorMessageId?: string;
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

const pendingDiscordAgentSessionBrowsers = new Map<
  string,
  PendingDiscordAgentSessionBrowserRequest
>();
const discordAgentSessionsActionStateByToken = new Map<string, DiscordAgentSessionsActionState>();

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
  now = Date.now(),
): PendingDiscordAgentSessionBrowserRequest | undefined {
  const pending = pendingDiscordAgentSessionBrowsers.get(requestId);
  if (!pending) {
    return undefined;
  }
  if (now - pending.requestedAt > DISCORD_AGENT_SESSIONS_STATE_TTL_MS) {
    pendingDiscordAgentSessionBrowsers.delete(requestId);
    return undefined;
  }
  return pending;
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
  now = Date.now(),
): DiscordAgentSessionsActionState | undefined {
  const state = discordAgentSessionsActionStateByToken.get(token);
  if (!state) {
    return undefined;
  }
  if (now - state.requestedAt > DISCORD_AGENT_SESSIONS_STATE_TTL_MS) {
    discordAgentSessionsActionStateByToken.delete(token);
    return undefined;
  }
  return state;
}

export function clearDiscordAgentSessionsActionState(token: string): void {
  discordAgentSessionsActionStateByToken.delete(token);
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

export function isSelectionExpired(
  selection: Pick<DiscordJobSelectionState, 'requestedAt'> | undefined,
  now = Date.now(),
): boolean {
  if (!selection) {
    return false;
  }

  return now - selection.requestedAt > DISCORD_SELECTION_TTL_MS;
}

export function getActiveDiscordSelection(
  selectionMap: Map<string, DiscordJobSelectionState>,
  userId: string,
  now = Date.now(),
): {
  selection?: DiscordJobSelectionState;
  expiredSelection?: DiscordJobSelectionState;
} {
  const selection = selectionMap.get(userId);
  if (!selection) {
    return {};
  }

  if (isSelectionExpired(selection, now)) {
    selectionMap.delete(userId);
    return { expiredSelection: selection };
  }

  return { selection };
}

function captureSelectionReplyId<T extends DiscordJobSelectionState>(
  selectionMap: Map<string, T>,
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
  selectionMap: Map<string, DiscordJobSelectionState>,
  flow: string,
  response: Pick<InteractionCallbackResponse, 'resource'>,
): void {
  captureSelectionReplyId(selectionMap, interaction.user.id, interaction.user.id, flow, response);
}

export function storeDiscordScopedSelectionReplyId(
  selectionMap: Map<string, DiscordScopedJobSelectionState>,
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
