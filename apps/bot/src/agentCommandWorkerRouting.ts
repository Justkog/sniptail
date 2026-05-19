import {
  chooseLeastActiveWorker,
  findEligibleAgentWorkers,
  isProfileConflicted,
  isWorkspaceAmbiguous,
  type AggregatedWorkspaceCapability,
  type EligibleAgentWorker,
} from '@sniptail/core/agent-capabilities/agentCapabilities.js';
import type { AgentCommandMetadata } from './agentCommandMetadataCache.js';

export type ResolvedAgentWorker = {
  workerId: string;
  workerLabel?: string;
};

function formatWorkerName(worker: { workerId: string; workerLabel?: string }): string {
  return worker.workerLabel ? `${worker.workerLabel} (${worker.workerId})` : worker.workerId;
}

function findWorkspace(
  metadata: AgentCommandMetadata,
  workspaceKey: string,
): AggregatedWorkspaceCapability | undefined {
  return metadata.aggregated.workspaces.find((workspace) => workspace.key === workspaceKey);
}

function findEligibleWorkers(
  metadata: AgentCommandMetadata,
  workspaceKey: string,
  profileKey: string,
): EligibleAgentWorker[] {
  return findEligibleAgentWorkers({
    aggregated: metadata.aggregated,
    workspaceKey,
    profileKey,
    activeSessionCounts: metadata.activeSessionCounts,
  });
}

export function buildAgentWorkerSelectionError(
  metadata: AgentCommandMetadata,
  workspaceKey: string,
  profileKey: string,
  requestedWorkerId?: string,
): string | undefined {
  const workspace = findWorkspace(metadata, workspaceKey);
  const profile = metadata.aggregated.profiles.find((item) => item.key === profileKey);

  if (!workspace) {
    return `Unknown workspace key: \`${workspaceKey}\`.`;
  }
  if (!profile) {
    return `Unknown agent profile key: \`${profileKey}\`.`;
  }
  if (isProfileConflicted(profile)) {
    return `Agent profile key: \`${profileKey}\` is currently conflicted across live workers. Please ask an operator to fix worker configuration.`;
  }

  const eligibleWorkers = findEligibleWorkers(metadata, workspaceKey, profileKey);
  if (!eligibleWorkers.length) {
    return `No live worker can run workspace \`${workspaceKey}\` with agent profile \`${profileKey}\` right now.`;
  }

  if (requestedWorkerId) {
    const requestedWorker = eligibleWorkers.find((worker) => worker.workerId === requestedWorkerId);
    if (requestedWorker) {
      return undefined;
    }
    return `Worker \`${requestedWorkerId}\` cannot run workspace \`${workspaceKey}\` with agent profile \`${profileKey}\` right now.`;
  }

  if (isWorkspaceAmbiguous(workspace)) {
    return `Workspace \`${workspaceKey}\` is ambiguous across live workers. Please choose a worker.`;
  }

  return undefined;
}

export function resolveAgentStartWorker(
  metadata: AgentCommandMetadata,
  workspaceKey: string,
  profileKey: string,
  requestedWorkerId?: string,
): ResolvedAgentWorker {
  const error = buildAgentWorkerSelectionError(
    metadata,
    workspaceKey,
    profileKey,
    requestedWorkerId,
  );
  if (error) {
    throw new Error(error);
  }

  const eligibleWorkers = findEligibleWorkers(metadata, workspaceKey, profileKey);
  const selectedWorker = requestedWorkerId
    ? eligibleWorkers.find((worker) => worker.workerId === requestedWorkerId)
    : chooseLeastActiveWorker(eligibleWorkers);

  if (!selectedWorker) {
    throw new Error(
      `No live worker can run workspace \`${workspaceKey}\` with agent profile \`${profileKey}\` right now.`,
    );
  }

  return {
    workerId: selectedWorker.workerId,
    ...(selectedWorker.workerLabel ? { workerLabel: selectedWorker.workerLabel } : {}),
  };
}

export function buildAgentWorkerChoices(
  metadata: AgentCommandMetadata,
  workspaceKey: string | undefined,
  profileKey: string | undefined,
): Array<{ name: string; value: string }> {
  if (!workspaceKey || !profileKey) {
    return metadata.aggregated.liveWorkers.map((worker) => ({
      name: formatWorkerName(worker),
      value: worker.workerId,
    }));
  }

  return findEligibleWorkers(metadata, workspaceKey, profileKey).map((worker) => ({
    name: formatWorkerName(worker),
    value: worker.workerId,
  }));
}
