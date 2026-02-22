const RUN_ACTION_ID_PATTERN = /^[a-z0-9](?:[a-z0-9._-]*[a-z0-9])?$/;

export type RepoRunActionsMetadata = {
  actionIds: string[];
  syncedAt: string;
  sourceRef: string;
};

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }
  return value as Record<string, unknown>;
}

function normalizeActionIds(actionIds: string[]): string[] {
  const unique = new Set<string>();
  for (const actionId of actionIds) {
    unique.add(normalizeRunActionId(actionId));
  }
  return Array.from(unique).sort((a, b) => a.localeCompare(b));
}

function safeNormalizeActionIds(actionIds: string[]): string[] {
  const unique = new Set<string>();
  for (const actionId of actionIds) {
    const normalized = tryNormalizeRunActionId(actionId);
    if (normalized) {
      unique.add(normalized);
    }
  }
  return Array.from(unique).sort((a, b) => a.localeCompare(b));
}

export function normalizeRunActionId(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (!normalized) {
    throw new Error('Run action id cannot be empty.');
  }
  if (!RUN_ACTION_ID_PATTERN.test(normalized)) {
    throw new Error(
      `Invalid run action id "${value}". Use lowercase letters, numbers, dot, underscore, or dash.`,
    );
  }
  if (normalized.includes('/') || normalized.includes('\\') || normalized.includes('..')) {
    throw new Error(`Invalid run action id "${value}". Path separators are not allowed.`);
  }
  return normalized;
}

export function tryNormalizeRunActionId(value: string): string | undefined {
  try {
    return normalizeRunActionId(value);
  } catch {
    return undefined;
  }
}

export function isValidRunActionId(value: string): boolean {
  return Boolean(tryNormalizeRunActionId(value));
}

export function listRunActionIds(providerData?: Record<string, unknown>): string[] {
  const metadata = getRepoRunActionsMetadata(providerData);
  return metadata?.actionIds ?? [];
}

export function getRepoRunActionsMetadata(
  providerData?: Record<string, unknown>,
): RepoRunActionsMetadata | undefined {
  if (!providerData) return undefined;
  const sniptail = asRecord(providerData.sniptail);
  const run = asRecord(sniptail?.run);
  if (!run) return undefined;

  const actionIdsRaw = run.actionIds;
  if (!Array.isArray(actionIdsRaw)) return undefined;
  const actionIds = actionIdsRaw.filter((value): value is string => typeof value === 'string');
  if (!actionIds.length) return undefined;

  const syncedAt = typeof run.syncedAt === 'string' ? run.syncedAt.trim() : '';
  const sourceRef = typeof run.sourceRef === 'string' ? run.sourceRef.trim() : '';
  if (!syncedAt || !sourceRef) return undefined;

  const normalizedActionIds = safeNormalizeActionIds(actionIds);
  if (!normalizedActionIds.length) return undefined;

  return {
    actionIds: normalizedActionIds,
    syncedAt,
    sourceRef,
  };
}

export function withRepoRunActionsMetadata(
  providerData: Record<string, unknown> | undefined,
  metadata: RepoRunActionsMetadata,
): Record<string, unknown> {
  const normalizedActionIds = normalizeActionIds(metadata.actionIds);
  const base = providerData ? { ...providerData } : {};
  const sniptail = asRecord(base.sniptail) ?? {};
  return {
    ...base,
    sniptail: {
      ...sniptail,
      run: {
        actionIds: normalizedActionIds,
        syncedAt: metadata.syncedAt,
        sourceRef: metadata.sourceRef,
      },
    },
  };
}

export function intersectRunActionIds(
  repoActionSets: string[][],
  availableActionIds: string[],
): string[] {
  if (!repoActionSets.length) return [];

  const availableSet = new Set(safeNormalizeActionIds(availableActionIds));
  let intersection = new Set<string>(safeNormalizeActionIds(repoActionSets[0] ?? []));

  for (const repoActionIds of repoActionSets.slice(1)) {
    const normalized = new Set(safeNormalizeActionIds(repoActionIds));
    intersection = new Set(Array.from(intersection).filter((value) => normalized.has(value)));
  }

  return Array.from(intersection)
    .filter((value) => availableSet.has(value))
    .sort((a, b) => a.localeCompare(b));
}
