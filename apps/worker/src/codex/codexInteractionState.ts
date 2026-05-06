import type { CodexTurnRuntime } from '@sniptail/core/agents/types.js';

export type ActiveCodexRuntime = {
  sessionId: string;
  codingAgentSessionId?: string;
  abort: () => void;
};

const activeCodexRuntimes = new Map<string, ActiveCodexRuntime>();

export function setActiveCodexRuntime(sessionId: string, runtime: CodexTurnRuntime): void {
  activeCodexRuntimes.set(sessionId, {
    sessionId,
    ...(runtime.threadId ? { codingAgentSessionId: runtime.threadId } : {}),
    abort: runtime.abort,
  });
}

export function getActiveCodexRuntime(sessionId: string): ActiveCodexRuntime | undefined {
  return activeCodexRuntimes.get(sessionId);
}

export function deleteActiveCodexRuntime(sessionId: string): void {
  activeCodexRuntimes.delete(sessionId);
}

export function clearActiveCodexRuntimes(): void {
  activeCodexRuntimes.clear();
}
