export type ActiveOpenCodeRuntimeRef = {
  codingAgentSessionId: string;
  baseUrl: string;
  directory: string;
  executionMode: 'local' | 'server' | 'docker';
};

export type PendingOpenCodePermission = {
  sessionId: string;
  interactionId: string;
  requestId: string;
  baseUrl: string;
  directory: string;
  workspace?: string;
  expiresAt: string;
  timeout?: NodeJS.Timeout;
};

const activeOpenCodeRuntimes = new Map<string, ActiveOpenCodeRuntimeRef>();
const pendingOpenCodePermissions = new Map<string, PendingOpenCodePermission>();

function pendingPermissionKey(sessionId: string, interactionId: string): string {
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
  clearAllPendingOpenCodePermissions();
}

export function setPendingOpenCodePermission(permission: PendingOpenCodePermission): void {
  pendingOpenCodePermissions.set(
    pendingPermissionKey(permission.sessionId, permission.interactionId),
    permission,
  );
}

export function getPendingOpenCodePermission(
  sessionId: string,
  interactionId: string,
): PendingOpenCodePermission | undefined {
  return pendingOpenCodePermissions.get(pendingPermissionKey(sessionId, interactionId));
}

export function takePendingOpenCodePermission(
  sessionId: string,
  interactionId: string,
): PendingOpenCodePermission | undefined {
  const key = pendingPermissionKey(sessionId, interactionId);
  const permission = pendingOpenCodePermissions.get(key);
  if (!permission) return undefined;
  pendingOpenCodePermissions.delete(key);
  if (permission.timeout) {
    clearTimeout(permission.timeout);
  }
  return permission;
}

export function clearPendingOpenCodePermissionsForSession(sessionId: string): void {
  for (const [key, permission] of pendingOpenCodePermissions) {
    if (permission.sessionId !== sessionId) continue;
    pendingOpenCodePermissions.delete(key);
    if (permission.timeout) {
      clearTimeout(permission.timeout);
    }
  }
}

function clearAllPendingOpenCodePermissions(): void {
  for (const permission of pendingOpenCodePermissions.values()) {
    if (permission.timeout) {
      clearTimeout(permission.timeout);
    }
  }
  pendingOpenCodePermissions.clear();
}
