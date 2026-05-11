import type { CopilotSessionRuntime } from '@sniptail/core/agents/types.js';

export type ActiveCopilotRuntime = {
  sessionId: string;
  codingAgentSessionId: string;
  abort: () => Promise<void>;
  sendImmediate: (message: string) => Promise<void>;
  enqueue: (message: string) => Promise<void>;
};

const activeCopilotRuntimes = new Map<string, ActiveCopilotRuntime>();

export function setActiveCopilotRuntime(sessionId: string, runtime: CopilotSessionRuntime): void {
  activeCopilotRuntimes.set(sessionId, {
    sessionId,
    codingAgentSessionId: runtime.sessionId,
    abort: runtime.abort,
    sendImmediate: runtime.sendImmediate,
    enqueue: runtime.enqueue,
  });
}

export function getActiveCopilotRuntime(sessionId: string): ActiveCopilotRuntime | undefined {
  return activeCopilotRuntimes.get(sessionId);
}

export function deleteActiveCopilotRuntime(sessionId: string): void {
  activeCopilotRuntimes.delete(sessionId);
}

export function clearActiveCopilotRuntimes(): void {
  activeCopilotRuntimes.clear();
}
