export const REGISTRY_KEY_VERSION = 'v1';
export const DEFAULT_WORKER_HEARTBEAT_TTL_MS = 90_000;

function registryPrefix(namespace: string): string {
  return `sniptail:registry:${namespace}:${REGISTRY_KEY_VERSION}`;
}

export function workerCapabilityKey(namespace: string, workerId: string): string {
  return `${registryPrefix(namespace)}:worker-capability:${workerId}`;
}

export function workerHeartbeatKey(namespace: string, workerId: string): string {
  return `${registryPrefix(namespace)}:worker-heartbeat:${workerId}`;
}

export function workerCapabilityIndexKey(namespace: string): string {
  return `${registryPrefix(namespace)}:worker-capability-index`;
}

export function agentSessionKey(namespace: string, sessionId: string): string {
  return `${registryPrefix(namespace)}:agent-session:${sessionId}`;
}

export function agentSessionIndexKey(namespace: string): string {
  return `${registryPrefix(namespace)}:agent-session-index`;
}
