export type ActiveOpenCodeRuntimeRef = {
  codingAgentSessionId: string;
  baseUrl: string;
  directory: string;
  executionMode: 'local' | 'server' | 'docker';
};

export type PendingOpenCodeInteraction = {
  sessionId: string;
  interactionId: string;
  kind: 'permission' | 'question';
  requestId: string;
  baseUrl: string;
  directory: string;
  workspace?: string;
  expiresAt: string;
  timeout?: NodeJS.Timeout;
};

export type PendingOpenCodePermission = PendingOpenCodeInteraction & {
  kind: 'permission';
};

export type PendingOpenCodeQuestion = PendingOpenCodeInteraction & {
  kind: 'question';
};

const activeOpenCodeRuntimes = new Map<string, ActiveOpenCodeRuntimeRef>();
const pendingOpenCodeInteractions = new Map<string, PendingOpenCodeInteraction>();

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
  pendingOpenCodeInteractions.set(
    pendingInteractionKey(interaction.sessionId, interaction.interactionId),
    interaction,
  );
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
  pendingOpenCodeInteractions.delete(key);
  if (interaction.timeout) {
    clearTimeout(interaction.timeout);
  }
  return interaction;
}

export function clearPendingOpenCodeInteractionsForSession(sessionId: string): void {
  for (const [key, interaction] of pendingOpenCodeInteractions) {
    if (interaction.sessionId !== sessionId) continue;
    pendingOpenCodeInteractions.delete(key);
    if (interaction.timeout) {
      clearTimeout(interaction.timeout);
    }
  }
}

function clearAllPendingOpenCodeInteractions(): void {
  for (const interaction of pendingOpenCodeInteractions.values()) {
    if (interaction.timeout) {
      clearTimeout(interaction.timeout);
    }
  }
  pendingOpenCodeInteractions.clear();
}

export const setPendingOpenCodePermission = setPendingOpenCodeInteraction;
export const getPendingOpenCodePermission = getPendingOpenCodeInteraction;
export const takePendingOpenCodePermission = takePendingOpenCodeInteraction;
export const clearPendingOpenCodePermissionsForSession = clearPendingOpenCodeInteractionsForSession;
