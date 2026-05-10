export type ActiveAcpRuntime = {
  sessionId: string;
  codingAgentSessionId: string;
  directory: string;
  cancel: () => Promise<void>;
};

const activeAcpRuntimes = new Map<string, ActiveAcpRuntime>();

export function setActiveAcpRuntime(sessionId: string, runtime: ActiveAcpRuntime): void {
  activeAcpRuntimes.set(sessionId, runtime);
}

export function getActiveAcpRuntime(sessionId: string): ActiveAcpRuntime | undefined {
  return activeAcpRuntimes.get(sessionId);
}

export function deleteActiveAcpRuntime(sessionId: string): void {
  activeAcpRuntimes.delete(sessionId);
}

export function clearActiveAcpRuntimes(): void {
  activeAcpRuntimes.clear();
}
