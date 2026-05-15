import { describe, expect, it, vi } from 'vitest';
import { loadAggregatedAgentCapabilitySnapshot } from './registryCapabilities.js';

describe('registryCapabilities', () => {
  it('aggregates live capabilities and derives active session counts from live owners only', async () => {
    const workerCapabilityStore = {
      upsertWorkerCapability: vi.fn(),
      loadWorkerCapability: vi.fn(),
      listWorkerCapabilities: vi.fn(async () => [
        {
          workerId: 'worker-a',
          enabled: true,
          workspaces: [{ key: 'snatch', label: 'Snatch' }],
          profiles: [{ key: 'build', provider: 'codex', label: 'Build' }],
          startedAt: '2026-05-15T10:00:00.000Z',
          lastSeenAt: '2026-05-15T10:00:20.000Z',
        },
        {
          workerId: 'worker-b',
          enabled: true,
          workspaces: [{ key: 'snatch', label: 'Other label' }],
          profiles: [{ key: 'build', provider: 'codex', label: 'Build' }],
          startedAt: '2026-05-15T10:00:00.000Z',
          lastSeenAt: '2026-05-15T09:59:00.000Z',
        },
      ]),
      refreshWorkerHeartbeat: vi.fn(),
      deleteWorkerCapability: vi.fn(),
    };
    const agentSessionOwnershipStore = {
      loadSessionOwnership: vi.fn(),
      updateSessionOwnership: vi.fn(),
      listActiveSessionCountsByWorkerIds: vi.fn(async (workerIds: string[]) =>
        Object.fromEntries(workerIds.map((workerId, index) => [workerId, index + 1])),
      ),
    };

    const snapshot = await loadAggregatedAgentCapabilitySnapshot({
      now: new Date('2026-05-15T10:00:25.000Z'),
      workerCapabilityStore,
      agentSessionOwnershipStore,
    });

    expect(snapshot.aggregated.liveWorkers.map((worker) => worker.workerId)).toEqual(['worker-a']);
    expect(snapshot.aggregated.staleWorkers.map((worker) => worker.workerId)).toEqual(['worker-b']);
    expect(snapshot.aggregated.workspaces).toEqual([
      expect.objectContaining({
        key: 'snatch',
        status: 'available',
        workerIds: ['worker-a'],
      }),
    ]);
    expect(agentSessionOwnershipStore.listActiveSessionCountsByWorkerIds).toHaveBeenCalledWith([
      'worker-a',
    ]);
    expect(snapshot.activeSessionCounts).toEqual({ 'worker-a': 1 });
  });
});
