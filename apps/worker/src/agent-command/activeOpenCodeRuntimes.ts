export type ActiveOpenCodeRuntimeRef = {
  codingAgentSessionId: string;
  baseUrl: string;
  directory: string;
  executionMode: 'local' | 'server' | 'docker';
};

const activeOpenCodeRuntimes = new Map<string, ActiveOpenCodeRuntimeRef>();

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
}
