import {
  aggregateAgentCapabilities,
  type AggregatedAgentCapabilities,
} from '../agent-capabilities/agentCapabilities.js';
import {
  getAgentSessionOwnershipRegistryStore,
  getWorkerCapabilityRegistryStore,
} from './registryStoreFactory.js';
import type {
  AgentSessionOwnershipRegistryStore,
  RegistryActiveSessionCounts,
  WorkerCapabilityRegistryStore,
} from './types.js';

export type AggregatedAgentCapabilityRegistrySnapshot = {
  aggregated: AggregatedAgentCapabilities;
  activeSessionCounts: RegistryActiveSessionCounts;
};

type LoadAggregatedAgentCapabilitySnapshotInput = {
  now?: Date;
  staleAfterMs?: number;
  workerCapabilityStore?: WorkerCapabilityRegistryStore;
  agentSessionOwnershipStore?: AgentSessionOwnershipRegistryStore;
};

export async function loadAggregatedAgentCapabilitySnapshot(
  input: LoadAggregatedAgentCapabilitySnapshotInput = {},
): Promise<AggregatedAgentCapabilityRegistrySnapshot> {
  const workerCapabilityStore =
    input.workerCapabilityStore ?? (await getWorkerCapabilityRegistryStore());
  const agentSessionOwnershipStore =
    input.agentSessionOwnershipStore ?? (await getAgentSessionOwnershipRegistryStore());
  const capabilities = await workerCapabilityStore.listWorkerCapabilities();
  const aggregated = aggregateAgentCapabilities({
    capabilities,
    ...(input.now ? { now: input.now } : {}),
    ...(input.staleAfterMs !== undefined ? { staleAfterMs: input.staleAfterMs } : {}),
  });
  const activeSessionCounts = await agentSessionOwnershipStore.listActiveSessionCountsByWorkerIds(
    aggregated.liveWorkers.map((worker) => worker.workerId),
  );

  return {
    aggregated,
    activeSessionCounts,
  };
}
