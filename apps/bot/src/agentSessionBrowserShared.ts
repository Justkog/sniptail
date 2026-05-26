import { isAbsolute } from 'node:path';
import type { AgentSessionListFilters } from '@sniptail/core/agent-sessions/listing.js';
import type {
  AgentCommandMetadata,
  AgentCommandProfileMetadata,
} from './agentCommandMetadataCache.js';

type LiveWorker = AgentCommandMetadata['aggregated']['liveWorkers'][number];

function normalizeOptionalString(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

export function validateAgentSessionBrowserCwd(cwd: string | undefined): string | undefined {
  const normalized = normalizeOptionalString(cwd);
  if (!normalized) {
    return undefined;
  }
  if (isAbsolute(normalized)) {
    throw new Error('`cwd` must be a relative path.');
  }
  return normalized;
}

export function normalizeAgentSessionBrowserFilters(
  filters: AgentSessionListFilters | undefined,
): AgentSessionListFilters | undefined {
  if (!filters) {
    return undefined;
  }

  const normalized: AgentSessionListFilters = {};
  const assignTrimmed = (
    key: keyof Omit<AgentSessionListFilters, 'roots'>,
    value: string | undefined,
  ) => {
    const trimmed = normalizeOptionalString(value);
    if (trimmed) {
      normalized[key] = trimmed;
    }
  };

  assignTrimmed('workspaceKey', filters.workspaceKey);
  assignTrimmed('cwd', filters.cwd);
  assignTrimmed('gitRoot', filters.gitRoot);
  assignTrimmed('repository', filters.repository);
  assignTrimmed('branch', filters.branch);
  assignTrimmed('search', filters.search);
  assignTrimmed('start', filters.start);

  const roots = filters.roots
    ?.map((root) => normalizeOptionalString(root))
    .filter((root): root is string => Boolean(root));
  if (roots?.length) {
    normalized.roots = [...new Set(roots)].sort((left, right) => left.localeCompare(right));
  }

  return Object.keys(normalized).length > 0 ? normalized : undefined;
}

export function agentSessionBrowserFiltersEqual(
  left: AgentSessionListFilters | undefined,
  right: AgentSessionListFilters | undefined,
): boolean {
  return (
    JSON.stringify(normalizeAgentSessionBrowserFilters(left) ?? {}) ===
    JSON.stringify(normalizeAgentSessionBrowserFilters(right) ?? {})
  );
}

export function findAgentSessionBrowserWorker(
  metadata: AgentCommandMetadata,
  workerId: string,
): LiveWorker | undefined {
  return metadata.aggregated.liveWorkers.find((worker) => worker.workerId === workerId);
}

export function findAgentSessionBrowserWorkerProfile(
  worker: LiveWorker,
  profileKey: string,
): AgentCommandProfileMetadata | undefined {
  const profile = worker.profiles.find((candidate) => candidate.key === profileKey);
  return profile
    ? {
        key: profile.key,
        status: 'available',
        provider: profile.provider,
        ...(profile.agent ? { agent: profile.agent } : {}),
        ...(profile.profile ? { profile: profile.profile } : {}),
        ...(profile.model ? { model: profile.model } : {}),
        ...(profile.modelProvider ? { modelProvider: profile.modelProvider } : {}),
        ...(profile.reasoningEffort ? { reasoningEffort: profile.reasoningEffort } : {}),
        ...(profile.label ? { label: profile.label } : {}),
        ...(profile.description ? { description: profile.description } : {}),
        workerIds: [worker.workerId],
      }
    : undefined;
}

export function validateAgentSessionBrowserSelection(input: {
  metadata: AgentCommandMetadata;
  workerId: string;
  agentProfileKey?: string;
  filters?: AgentSessionListFilters;
}): { worker: LiveWorker } {
  const worker = findAgentSessionBrowserWorker(input.metadata, input.workerId);
  if (!worker) {
    throw new Error(
      `Worker \`${input.workerId}\` is not live. Refresh the worker list and try again.`,
    );
  }

  if (
    input.agentProfileKey &&
    !findAgentSessionBrowserWorkerProfile(worker, input.agentProfileKey)
  ) {
    throw new Error(
      `Worker \`${input.workerId}\` does not expose agent profile \`${input.agentProfileKey}\`.`,
    );
  }

  const workspaceKey = input.filters?.workspaceKey?.trim();
  if (workspaceKey && !worker.workspaces.some((workspace) => workspace.key === workspaceKey)) {
    throw new Error(`Worker \`${input.workerId}\` does not expose workspace \`${workspaceKey}\`.`);
  }

  return { worker };
}
