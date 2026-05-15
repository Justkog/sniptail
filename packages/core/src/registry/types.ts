import type { WorkerAgentCapability } from '../agent-capabilities/agentCapabilities.js';

export type RegistryWorkerCapabilityRecord = WorkerAgentCapability;

export type RegistryWorkerHeartbeat = {
  workerId: string;
  workerLabel?: string;
  startedAt: string;
  lastSeenAt: string;
  activeRuntimeCount?: number;
  maxActiveSessions?: number;
};

export type AgentSessionOwnershipRecord = {
  sessionId: string;
  ownerWorkerId?: string;
  ownerWorkerLabel?: string;
  workerClaimedAt?: string;
  ownerStaleSince?: string;
};

export type UpdateAgentSessionOwnershipInput = AgentSessionOwnershipRecord;

export type RegistryActiveSessionCounts = Record<string, number>;

export interface WorkerCapabilityRegistryStore {
  upsertWorkerCapability(record: RegistryWorkerCapabilityRecord): Promise<void>;
  loadWorkerCapability(workerId: string): Promise<RegistryWorkerCapabilityRecord | undefined>;
  listWorkerCapabilities(): Promise<RegistryWorkerCapabilityRecord[]>;
  refreshWorkerHeartbeat(input: RegistryWorkerHeartbeat): Promise<void>;
  deleteWorkerCapability(workerId: string): Promise<void>;
}

export interface AgentSessionOwnershipRegistryStore {
  loadSessionOwnership(sessionId: string): Promise<AgentSessionOwnershipRecord | undefined>;
  updateSessionOwnership(input: UpdateAgentSessionOwnershipInput): Promise<void>;
  listActiveSessionCountsByWorkerIds(workerIds: string[]): Promise<RegistryActiveSessionCounts>;
}
