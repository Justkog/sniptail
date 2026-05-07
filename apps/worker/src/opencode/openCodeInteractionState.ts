import type { BotEvent } from '@sniptail/core/types/bot-event.js';

export type ActiveOpenCodeRuntimeRef = {
  codingAgentSessionId: string;
  baseUrl: string;
  directory: string;
  executionMode: 'local' | 'server' | 'docker';
};

type PendingOpenCodeInteractionBase = {
  sessionId: string;
  interactionId: string;
  requestId: string;
  baseUrl: string;
  directory: string;
  workspace?: string;
  expiresAt: string;
  timeout?: NodeJS.Timeout;
};

export type PendingOpenCodePermissionDisplayState = 'queued' | 'visible' | 'reply_sent';

export type PendingOpenCodePermission = PendingOpenCodeInteractionBase & {
  kind: 'permission';
  displayState: PendingOpenCodePermissionDisplayState;
  requestEvent: BotEvent;
};

export type PendingOpenCodeQuestion = PendingOpenCodeInteractionBase & {
  kind: 'question';
};

export type PendingOpenCodeInteraction = PendingOpenCodePermission | PendingOpenCodeQuestion;

const activeOpenCodeRuntimes = new Map<string, ActiveOpenCodeRuntimeRef>();
const pendingOpenCodeInteractions = new Map<string, PendingOpenCodeInteraction>();
const pendingOpenCodePermissionOrder = new Map<string, string[]>();
const pendingOpenCodePermissionByRequestId = new Map<string, string>();
const pendingOpenCodePermissionPromotionTimers = new Map<string, NodeJS.Timeout>();

function pendingInteractionKey(sessionId: string, interactionId: string): string {
  return `${sessionId}:${interactionId}`;
}

export function setActiveOpenCodeRuntime(sessionId: string, ref: ActiveOpenCodeRuntimeRef): void {
  activeOpenCodeRuntimes.set(sessionId, ref);
}

export function getActiveOpenCodeRuntime(sessionId: string): ActiveOpenCodeRuntimeRef | undefined {
  return activeOpenCodeRuntimes.get(sessionId);
}

export function deleteActiveOpenCodeRuntime(sessionId: string): void {
  activeOpenCodeRuntimes.delete(sessionId);
}

export function clearActiveOpenCodeRuntimes(): void {
  activeOpenCodeRuntimes.clear();
  clearAllPendingOpenCodeInteractions();
}

export function setPendingOpenCodeInteraction(interaction: PendingOpenCodeInteraction): void {
  const key = pendingInteractionKey(interaction.sessionId, interaction.interactionId);
  pendingOpenCodeInteractions.set(key, interaction);
  if (interaction.kind === 'permission') {
    const order = pendingOpenCodePermissionOrder.get(interaction.sessionId) ?? [];
    if (!order.includes(interaction.interactionId)) {
      order.push(interaction.interactionId);
    }
    pendingOpenCodePermissionOrder.set(interaction.sessionId, order);
    pendingOpenCodePermissionByRequestId.set(interaction.requestId, key);
  }
}

export function getPendingOpenCodeInteraction(
  sessionId: string,
  interactionId: string,
): PendingOpenCodeInteraction | undefined {
  return pendingOpenCodeInteractions.get(pendingInteractionKey(sessionId, interactionId));
}

export function takePendingOpenCodeInteraction(
  sessionId: string,
  interactionId: string,
): PendingOpenCodeInteraction | undefined {
  const key = pendingInteractionKey(sessionId, interactionId);
  const interaction = pendingOpenCodeInteractions.get(key);
  if (!interaction) return undefined;
  deletePendingOpenCodeInteraction(key, interaction);
  return interaction;
}

export function clearPendingOpenCodeInteractionsForSession(sessionId: string): void {
  clearPendingOpenCodePermissionPromotionTimer(sessionId);
  for (const [key, interaction] of pendingOpenCodeInteractions) {
    if (interaction.sessionId !== sessionId) continue;
    deletePendingOpenCodeInteraction(key, interaction);
  }
  pendingOpenCodePermissionOrder.delete(sessionId);
}

function clearAllPendingOpenCodeInteractions(): void {
  for (const interaction of pendingOpenCodeInteractions.values()) {
    if (interaction.timeout) {
      clearTimeout(interaction.timeout);
    }
  }
  pendingOpenCodeInteractions.clear();
  pendingOpenCodePermissionOrder.clear();
  pendingOpenCodePermissionByRequestId.clear();
  for (const timer of pendingOpenCodePermissionPromotionTimers.values()) {
    clearTimeout(timer);
  }
  pendingOpenCodePermissionPromotionTimers.clear();
}

function deletePendingOpenCodeInteraction(
  key: string,
  interaction: PendingOpenCodeInteraction,
): void {
  pendingOpenCodeInteractions.delete(key);
  if (interaction.timeout) {
    clearTimeout(interaction.timeout);
  }
  if (interaction.kind !== 'permission') return;
  pendingOpenCodePermissionByRequestId.delete(interaction.requestId);
  const order = pendingOpenCodePermissionOrder.get(interaction.sessionId);
  if (!order) return;
  const nextOrder = order.filter((interactionId) => interactionId !== interaction.interactionId);
  if (nextOrder.length) {
    pendingOpenCodePermissionOrder.set(interaction.sessionId, nextOrder);
  } else {
    pendingOpenCodePermissionOrder.delete(interaction.sessionId);
  }
}

function getPendingOpenCodePermissionInternal(
  sessionId: string,
  interactionId: string,
): PendingOpenCodePermission | undefined {
  const pending = getPendingOpenCodeInteraction(sessionId, interactionId);
  return pending?.kind === 'permission' ? pending : undefined;
}

export function takePendingOpenCodePermissionByRequestId(
  requestId: string,
): PendingOpenCodePermission | undefined {
  const key = pendingOpenCodePermissionByRequestId.get(requestId);
  if (!key) return undefined;
  const interaction = pendingOpenCodeInteractions.get(key);
  if (!interaction || interaction.kind !== 'permission') return undefined;
  deletePendingOpenCodeInteraction(key, interaction);
  return interaction;
}

export function hasVisibleOpenCodePermission(sessionId: string): boolean {
  const order = pendingOpenCodePermissionOrder.get(sessionId) ?? [];
  return order.some((interactionId) => {
    const pending = getPendingOpenCodePermissionInternal(sessionId, interactionId);
    return pending?.displayState === 'visible' || pending?.displayState === 'reply_sent';
  });
}

export function markPendingOpenCodePermissionVisible(
  sessionId: string,
  interactionId: string,
): PendingOpenCodePermission | undefined {
  const pending = getPendingOpenCodePermissionInternal(sessionId, interactionId);
  if (!pending) return undefined;
  pending.displayState = 'visible';
  return pending;
}

export function markPendingOpenCodePermissionReplySent(
  sessionId: string,
  interactionId: string,
): PendingOpenCodePermission | undefined {
  const pending = getPendingOpenCodePermissionInternal(sessionId, interactionId);
  if (!pending) return undefined;
  pending.displayState = 'reply_sent';
  return pending;
}

export function promoteNextQueuedOpenCodePermission(
  sessionId: string,
): PendingOpenCodePermission | undefined {
  clearPendingOpenCodePermissionPromotionTimer(sessionId);
  if (hasVisibleOpenCodePermission(sessionId)) return undefined;
  const order = pendingOpenCodePermissionOrder.get(sessionId) ?? [];
  for (const interactionId of order) {
    const pending = getPendingOpenCodePermissionInternal(sessionId, interactionId);
    if (!pending || pending.displayState !== 'queued') continue;
    pending.displayState = 'visible';
    return pending;
  }
  return undefined;
}

export function scheduleOpenCodePermissionPromotion(
  sessionId: string,
  delayMs: number,
  callback: () => void,
): void {
  clearPendingOpenCodePermissionPromotionTimer(sessionId);
  const timer = setTimeout(() => {
    pendingOpenCodePermissionPromotionTimers.delete(sessionId);
    callback();
  }, delayMs);
  pendingOpenCodePermissionPromotionTimers.set(sessionId, timer);
}

export function hasScheduledOpenCodePermissionPromotion(sessionId: string): boolean {
  return pendingOpenCodePermissionPromotionTimers.has(sessionId);
}

function clearPendingOpenCodePermissionPromotionTimer(sessionId: string): void {
  const timer = pendingOpenCodePermissionPromotionTimers.get(sessionId);
  if (!timer) return;
  clearTimeout(timer);
  pendingOpenCodePermissionPromotionTimers.delete(sessionId);
}

export const setPendingOpenCodePermission = setPendingOpenCodeInteraction;
export const getPendingOpenCodePermission = getPendingOpenCodeInteraction;
export const takePendingOpenCodePermission = takePendingOpenCodeInteraction;
export const clearPendingOpenCodePermissionsForSession = clearPendingOpenCodeInteractionsForSession;
