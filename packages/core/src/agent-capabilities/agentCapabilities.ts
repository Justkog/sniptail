import type { ModelReasoningEffort } from '@openai/codex-sdk';

export type AgentCapabilityProvider = 'codex' | 'opencode' | 'copilot' | 'acp';

export type WorkerAgentCapabilityWorkspace = {
  key: string;
  label?: string;
  description?: string;
};

export type WorkerAgentCapabilityProfile = {
  key: string;
  provider: AgentCapabilityProvider;
  agent?: string;
  profile?: string;
  model?: string;
  modelProvider?: string;
  reasoningEffort?: ModelReasoningEffort;
  label?: string;
  description?: string;
};

export type WorkerAgentCapability = {
  workerId: string;
  workerLabel?: string;
  enabled: boolean;
  workspaces: WorkerAgentCapabilityWorkspace[];
  profiles: WorkerAgentCapabilityProfile[];
  activeRuntimeCount?: number;
  maxActiveSessions?: number;
  startedAt: string;
  lastSeenAt: string;
};

export type ResolvedWorkerAgentCapability = WorkerAgentCapability & {
  isLive: boolean;
  isStale: boolean;
};

export type AggregatedWorkerWorkspaceCapability = WorkerAgentCapabilityWorkspace & {
  workerId: string;
  workerLabel?: string;
};

export type AggregatedWorkerProfileCapability = WorkerAgentCapabilityProfile & {
  workerId: string;
  workerLabel?: string;
};

export type AggregatedWorkspaceCapability = {
  key: string;
  status: 'available' | 'ambiguous';
  label?: string;
  description?: string;
  workerIds: string[];
  workers: AggregatedWorkerWorkspaceCapability[];
};

export type AggregatedProfileCapability = {
  key: string;
  status: 'available' | 'conflicted';
  provider?: AgentCapabilityProvider;
  agent?: string;
  profile?: string;
  model?: string;
  modelProvider?: string;
  reasoningEffort?: ModelReasoningEffort;
  label?: string;
  description?: string;
  workerIds: string[];
  workers: AggregatedWorkerProfileCapability[];
};

export type AggregatedAgentCapabilities = {
  generatedAt: string;
  staleAfterMs: number;
  workers: ResolvedWorkerAgentCapability[];
  liveWorkers: ResolvedWorkerAgentCapability[];
  staleWorkers: ResolvedWorkerAgentCapability[];
  disabledWorkers: ResolvedWorkerAgentCapability[];
  workspaces: AggregatedWorkspaceCapability[];
  profiles: AggregatedProfileCapability[];
};

export type EligibleAgentWorker = {
  workerId: string;
  workerLabel?: string;
  activeSessionCount: number;
  maxActiveSessions?: number;
  remainingCapacity?: number;
  workspace: AggregatedWorkerWorkspaceCapability;
  profile: AggregatedWorkerProfileCapability;
};

const DEFAULT_STALE_AFTER_MS = 30_000;

type AggregateAgentCapabilitiesInput = {
  capabilities: WorkerAgentCapability[];
  now?: Date;
  staleAfterMs?: number;
};

type FindEligibleAgentWorkersInput = {
  aggregated: AggregatedAgentCapabilities;
  workspaceKey: string;
  profileKey: string;
  activeSessionCounts?: Record<string, number>;
};

function compareWorkerId(a: { workerId: string }, b: { workerId: string }): number {
  return a.workerId.localeCompare(b.workerId);
}

function compareEligibleWorker(a: EligibleAgentWorker, b: EligibleAgentWorker): number {
  if (a.activeSessionCount !== b.activeSessionCount) {
    return a.activeSessionCount - b.activeSessionCount;
  }
  return a.workerId.localeCompare(b.workerId);
}

function requireFirst<T>(items: T[], message: string): T {
  const [firstItem] = items;
  if (firstItem === undefined) {
    throw new Error(message);
  }
  return firstItem;
}

function matchesWorkspaceMetadata(
  left: WorkerAgentCapabilityWorkspace,
  right: WorkerAgentCapabilityWorkspace,
): boolean {
  return left.label === right.label && left.description === right.description;
}

function matchesProfileDefinition(
  left: WorkerAgentCapabilityProfile,
  right: WorkerAgentCapabilityProfile,
): boolean {
  return (
    left.provider === right.provider &&
    left.agent === right.agent &&
    left.profile === right.profile &&
    left.model === right.model &&
    left.modelProvider === right.modelProvider &&
    left.reasoningEffort === right.reasoningEffort &&
    left.label === right.label &&
    left.description === right.description
  );
}

function resolveWorkerCapabilityState(
  capability: WorkerAgentCapability,
  nowMs: number,
  staleAfterMs: number,
): ResolvedWorkerAgentCapability {
  const lastSeenAtMs = Date.parse(capability.lastSeenAt);
  const isFresh = Number.isFinite(lastSeenAtMs) && nowMs - lastSeenAtMs <= staleAfterMs;
  const isLive = capability.enabled && isFresh;
  return {
    ...capability,
    isLive,
    isStale: capability.enabled && !isFresh,
  };
}

function buildAggregatedWorkspaces(
  capabilities: ResolvedWorkerAgentCapability[],
): AggregatedWorkspaceCapability[] {
  const byKey = new Map<string, AggregatedWorkerWorkspaceCapability[]>();
  for (const capability of capabilities) {
    for (const workspace of capability.workspaces) {
      const entry = {
        workerId: capability.workerId,
        ...(capability.workerLabel ? { workerLabel: capability.workerLabel } : {}),
        ...workspace,
      };
      const existing = byKey.get(workspace.key);
      if (existing) {
        existing.push(entry);
      } else {
        byKey.set(workspace.key, [entry]);
      }
    }
  }

  return [...byKey.entries()]
    .sort(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey))
    .map(([key, workers]) => {
      const sortedWorkers = [...workers].sort(compareWorkerId);
      const firstWorker = requireFirst(
        sortedWorkers,
        `Workspace capability aggregation produced an empty worker list for key "${key}".`,
      );
      const ambiguous = sortedWorkers.some(
        (worker) => !matchesWorkspaceMetadata(firstWorker, worker),
      );
      return {
        key,
        status: ambiguous ? 'ambiguous' : 'available',
        ...(!ambiguous && firstWorker.label ? { label: firstWorker.label } : {}),
        ...(!ambiguous && firstWorker.description ? { description: firstWorker.description } : {}),
        workerIds: sortedWorkers.map((worker) => worker.workerId),
        workers: sortedWorkers,
      };
    });
}

function buildAggregatedProfiles(
  capabilities: ResolvedWorkerAgentCapability[],
): AggregatedProfileCapability[] {
  const byKey = new Map<string, AggregatedWorkerProfileCapability[]>();
  for (const capability of capabilities) {
    for (const profile of capability.profiles) {
      const entry = {
        workerId: capability.workerId,
        ...(capability.workerLabel ? { workerLabel: capability.workerLabel } : {}),
        ...profile,
      };
      const existing = byKey.get(profile.key);
      if (existing) {
        existing.push(entry);
      } else {
        byKey.set(profile.key, [entry]);
      }
    }
  }

  return [...byKey.entries()]
    .sort(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey))
    .map(([key, workers]) => {
      const sortedWorkers = [...workers].sort(compareWorkerId);
      const firstWorker = requireFirst(
        sortedWorkers,
        `Profile capability aggregation produced an empty worker list for key "${key}".`,
      );
      const conflicted = sortedWorkers.some(
        (worker) => !matchesProfileDefinition(firstWorker, worker),
      );
      return {
        key,
        status: conflicted ? 'conflicted' : 'available',
        ...(!conflicted ? { provider: firstWorker.provider } : {}),
        ...(!conflicted && firstWorker.agent ? { agent: firstWorker.agent } : {}),
        ...(!conflicted && firstWorker.profile ? { profile: firstWorker.profile } : {}),
        ...(!conflicted && firstWorker.model ? { model: firstWorker.model } : {}),
        ...(!conflicted && firstWorker.modelProvider
          ? { modelProvider: firstWorker.modelProvider }
          : {}),
        ...(!conflicted && firstWorker.reasoningEffort
          ? { reasoningEffort: firstWorker.reasoningEffort }
          : {}),
        ...(!conflicted && firstWorker.label ? { label: firstWorker.label } : {}),
        ...(!conflicted && firstWorker.description ? { description: firstWorker.description } : {}),
        workerIds: sortedWorkers.map((worker) => worker.workerId),
        workers: sortedWorkers,
      };
    });
}

export function aggregateAgentCapabilities(
  input: AggregateAgentCapabilitiesInput,
): AggregatedAgentCapabilities {
  const staleAfterMs = input.staleAfterMs ?? DEFAULT_STALE_AFTER_MS;
  const now = input.now ?? new Date();
  const nowMs = now.getTime();
  const workers = [...input.capabilities]
    .map((capability) => resolveWorkerCapabilityState(capability, nowMs, staleAfterMs))
    .sort(compareWorkerId);
  const liveWorkers = workers.filter((worker) => worker.isLive);
  const staleWorkers = workers.filter((worker) => worker.isStale);
  const disabledWorkers = workers.filter((worker) => !worker.enabled);

  return {
    generatedAt: now.toISOString(),
    staleAfterMs,
    workers,
    liveWorkers,
    staleWorkers,
    disabledWorkers,
    workspaces: buildAggregatedWorkspaces(liveWorkers),
    profiles: buildAggregatedProfiles(liveWorkers),
  };
}

export function isWorkspaceAmbiguous(
  workspace: AggregatedWorkspaceCapability | undefined,
): workspace is AggregatedWorkspaceCapability & { status: 'ambiguous' } {
  return workspace?.status === 'ambiguous';
}

export function isProfileConflicted(
  profile: AggregatedProfileCapability | undefined,
): profile is AggregatedProfileCapability & { status: 'conflicted' } {
  return profile?.status === 'conflicted';
}

export function findEligibleAgentWorkers(
  input: FindEligibleAgentWorkersInput,
): EligibleAgentWorker[] {
  const workspace = input.aggregated.workspaces.find((item) => item.key === input.workspaceKey);
  const profile = input.aggregated.profiles.find((item) => item.key === input.profileKey);
  if (!workspace || !profile || isProfileConflicted(profile)) {
    return [];
  }

  const activeSessionCounts = input.activeSessionCounts ?? {};
  return input.aggregated.liveWorkers
    .flatMap((worker) => {
      const workerWorkspace = worker.workspaces.find((item) => item.key === input.workspaceKey);
      const workerProfile = worker.profiles.find((item) => item.key === input.profileKey);
      if (!workerWorkspace || !workerProfile) {
        return [];
      }

      const activeSessionCount = activeSessionCounts[worker.workerId] ?? 0;
      if (
        worker.maxActiveSessions !== undefined &&
        activeSessionCount >= worker.maxActiveSessions
      ) {
        return [];
      }

      return [
        {
          workerId: worker.workerId,
          ...(worker.workerLabel ? { workerLabel: worker.workerLabel } : {}),
          activeSessionCount,
          ...(worker.maxActiveSessions !== undefined
            ? {
                maxActiveSessions: worker.maxActiveSessions,
                remainingCapacity: Math.max(worker.maxActiveSessions - activeSessionCount, 0),
              }
            : {}),
          workspace: {
            workerId: worker.workerId,
            ...(worker.workerLabel ? { workerLabel: worker.workerLabel } : {}),
            ...workerWorkspace,
          },
          profile: {
            workerId: worker.workerId,
            ...(worker.workerLabel ? { workerLabel: worker.workerLabel } : {}),
            ...workerProfile,
          },
        },
      ];
    })
    .sort(compareEligibleWorker);
}

export function chooseLeastActiveWorker(
  workers: EligibleAgentWorker[],
): EligibleAgentWorker | undefined {
  return [...workers].sort(compareEligibleWorker)[0];
}
