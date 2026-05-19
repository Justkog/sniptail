import type {
  WorkerAgentCapabilityProfile,
  WorkerAgentCapabilityWorkspace,
} from '@sniptail/core/agent-capabilities/agentCapabilities.js';
import type { WorkerConfig } from '@sniptail/core/config/types.js';
import { logger } from '@sniptail/core/logger.js';
import { createWorkerCapabilityRegistryStore } from '@sniptail/core/registry/registryStoreFactory.js';
import type {
  RegistryWorkerCapabilityRecord,
  RegistryWorkerHeartbeat,
} from '@sniptail/core/registry/types.js';
import { getActiveAgentPromptTurnCount } from './activeAgentPromptTurns.js';

export const WORKER_CAPABILITY_HEARTBEAT_INTERVAL_MS = 10_000;

export type WorkerCapabilityPublisher = {
  close(): Promise<void>;
};

function buildWorkspaces(config: WorkerConfig): WorkerAgentCapabilityWorkspace[] {
  return Object.entries(config.agent.workspaces)
    .map(([key, workspace]) => ({
      key,
      ...(workspace.label ? { label: workspace.label } : {}),
      ...(workspace.description ? { description: workspace.description } : {}),
    }))
    .sort((a, b) => a.key.localeCompare(b.key));
}

function buildProfiles(config: WorkerConfig): WorkerAgentCapabilityProfile[] {
  return Object.entries(config.agent.profiles)
    .map(([key, profile]) => ({
      key,
      provider: profile.provider,
      ...(profile.agent ? { agent: profile.agent } : {}),
      ...(profile.profile ? { profile: profile.profile } : {}),
      ...(profile.model ? { model: profile.model } : {}),
      ...(profile.modelProvider ? { modelProvider: profile.modelProvider } : {}),
      ...(profile.reasoningEffort ? { reasoningEffort: profile.reasoningEffort } : {}),
      ...(profile.label ? { label: profile.label } : {}),
      ...(profile.description ? { description: profile.description } : {}),
    }))
    .sort((a, b) => a.key.localeCompare(b.key));
}

function buildCapabilityRecord(
  config: WorkerConfig,
  startedAt: string,
  lastSeenAt: string,
): RegistryWorkerCapabilityRecord {
  return {
    workerId: config.workerId,
    ...(config.workerLabel ? { workerLabel: config.workerLabel } : {}),
    enabled: config.agent.enabled,
    workspaces: buildWorkspaces(config),
    profiles: buildProfiles(config),
    activeRuntimeCount: getActiveAgentPromptTurnCount(),
    startedAt,
    lastSeenAt,
  };
}

function buildHeartbeat(config: WorkerConfig, startedAt: string): RegistryWorkerHeartbeat {
  return {
    workerId: config.workerId,
    ...(config.workerLabel ? { workerLabel: config.workerLabel } : {}),
    startedAt,
    lastSeenAt: new Date().toISOString(),
    activeRuntimeCount: getActiveAgentPromptTurnCount(),
  };
}

export async function startWorkerCapabilityPublisher(
  config: WorkerConfig,
): Promise<WorkerCapabilityPublisher> {
  if (!config.agent.enabled) {
    return {
      close(): Promise<void> {
        return Promise.resolve();
      },
    };
  }

  const store = await createWorkerCapabilityRegistryStore(config);
  const startedAt = new Date().toISOString();
  await store.upsertWorkerCapability(buildCapabilityRecord(config, startedAt, startedAt));

  const timer = setInterval(() => {
    void store.refreshWorkerHeartbeat(buildHeartbeat(config, startedAt)).catch((err) => {
      logger.warn(
        { err, workerId: config.workerId },
        'Failed to refresh worker capability heartbeat',
      );
    });
  }, WORKER_CAPABILITY_HEARTBEAT_INTERVAL_MS);
  timer.unref?.();

  return {
    close(): Promise<void> {
      clearInterval(timer);
      return Promise.resolve();
    },
  };
}
