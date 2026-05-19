import { beforeEach, describe, expect, it, vi } from 'vitest';

const hoisted = vi.hoisted(() => ({
  createWorkerCapabilityRegistryStore: vi.fn(),
  getActiveAgentPromptTurnCount: vi.fn(() => 0),
}));

vi.mock('@sniptail/core/registry/registryStoreFactory.js', () => ({
  createWorkerCapabilityRegistryStore: hoisted.createWorkerCapabilityRegistryStore,
}));

vi.mock('@sniptail/core/logger.js', () => ({
  logger: {
    warn: vi.fn(),
  },
}));

vi.mock('./activeAgentPromptTurns.js', () => ({
  getActiveAgentPromptTurnCount: hoisted.getActiveAgentPromptTurnCount,
}));

import {
  startWorkerCapabilityPublisher,
  WORKER_CAPABILITY_HEARTBEAT_INTERVAL_MS,
} from './workerCapabilityPublisher.js';

describe('workerCapabilityPublisher', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-15T10:00:00.000Z'));
    hoisted.getActiveAgentPromptTurnCount.mockReturnValue(0);
  });

  it('does nothing when agent command is disabled', async () => {
    const handle = await startWorkerCapabilityPublisher({
      workerId: 'worker-a',
      agent: {
        enabled: false,
        interactionTimeoutMs: 300_000,
        outputDebounceMs: 1_000,
        workspaces: {},
        profiles: {},
      },
    } as never);

    expect(hoisted.createWorkerCapabilityRegistryStore).not.toHaveBeenCalled();
    await handle.close();
  });

  it('publishes capabilities immediately and refreshes heartbeat on a timer', async () => {
    const store = {
      upsertWorkerCapability: vi.fn(() => Promise.resolve(undefined)),
      loadWorkerCapability: vi.fn(),
      listWorkerCapabilities: vi.fn(),
      refreshWorkerHeartbeat: vi.fn(() => Promise.resolve(undefined)),
      deleteWorkerCapability: vi.fn(),
    };
    hoisted.createWorkerCapabilityRegistryStore.mockResolvedValue(store);
    hoisted.getActiveAgentPromptTurnCount.mockReturnValue(2);

    const handle = await startWorkerCapabilityPublisher({
      workerId: 'worker-a',
      workerLabel: 'Worker A',
      registryDriver: 'sqlite',
      registryPath: '/tmp/registry',
      registryNamespace: 'local',
      agent: {
        enabled: true,
        interactionTimeoutMs: 300_000,
        outputDebounceMs: 1_000,
        workspaces: {
          snatch: {
            path: '/srv/snatch',
            label: 'Snatch',
          },
        },
        profiles: {
          build: {
            provider: 'codex',
            label: 'Build',
            model: 'gpt-5',
          },
        },
      },
    } as never);

    expect(store.upsertWorkerCapability).toHaveBeenCalledWith({
      workerId: 'worker-a',
      workerLabel: 'Worker A',
      enabled: true,
      workspaces: [{ key: 'snatch', label: 'Snatch' }],
      profiles: [{ key: 'build', provider: 'codex', label: 'Build', model: 'gpt-5' }],
      activeRuntimeCount: 2,
      startedAt: '2026-05-15T10:00:00.000Z',
      lastSeenAt: '2026-05-15T10:00:00.000Z',
    });

    vi.advanceTimersByTime(WORKER_CAPABILITY_HEARTBEAT_INTERVAL_MS);
    await vi.runOnlyPendingTimersAsync();

    expect(store.refreshWorkerHeartbeat).toHaveBeenCalledWith({
      workerId: 'worker-a',
      workerLabel: 'Worker A',
      startedAt: '2026-05-15T10:00:00.000Z',
      lastSeenAt: '2026-05-15T10:00:10.000Z',
      activeRuntimeCount: 2,
    });

    await handle.close();
  });

  it('stops refreshing after close', async () => {
    const store = {
      upsertWorkerCapability: vi.fn(() => Promise.resolve(undefined)),
      loadWorkerCapability: vi.fn(),
      listWorkerCapabilities: vi.fn(),
      refreshWorkerHeartbeat: vi.fn(() => Promise.resolve(undefined)),
      deleteWorkerCapability: vi.fn(),
    };
    hoisted.createWorkerCapabilityRegistryStore.mockResolvedValue(store);

    const handle = await startWorkerCapabilityPublisher({
      workerId: 'worker-a',
      registryDriver: 'sqlite',
      registryPath: '/tmp/registry',
      registryNamespace: 'local',
      agent: {
        enabled: true,
        interactionTimeoutMs: 300_000,
        outputDebounceMs: 1_000,
        workspaces: {
          snatch: {
            path: '/srv/snatch',
          },
        },
        profiles: {
          build: {
            provider: 'codex',
            model: 'gpt-5',
          },
        },
      },
    } as never);

    await handle.close();
    vi.advanceTimersByTime(WORKER_CAPABILITY_HEARTBEAT_INTERVAL_MS * 2);
    await vi.runOnlyPendingTimersAsync();

    expect(store.refreshWorkerHeartbeat).not.toHaveBeenCalled();
  });
});
