import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentSessionRecord } from '@sniptail/core/agent-sessions/types.js';
import { resolveAgentSessionOwnerMailboxRoute } from './agentCommandShared.js';

const hoisted = vi.hoisted(() => ({
  loadAgentCommandMetadata: vi.fn(),
  updateAgentSessionOwnership: vi.fn(),
}));

vi.mock('./agentCommandMetadataCache.js', () => ({
  loadAgentCommandMetadata: hoisted.loadAgentCommandMetadata,
}));

vi.mock('@sniptail/core/queue/queue.js', () => ({
  enqueueWorkerMailboxEvent: vi.fn(),
}));

vi.mock('@sniptail/core/types/worker-event.js', () => ({
  WORKER_EVENT_SCHEMA_VERSION: 1,
}));

vi.mock('@sniptail/core/agent-sessions/registry.js', () => ({
  updateAgentSessionOwnership: hoisted.updateAgentSessionOwnership,
}));

function buildSession(overrides: Partial<AgentSessionRecord> = {}): AgentSessionRecord {
  return {
    sessionId: 'session-1',
    provider: 'discord',
    channelId: 'channel-1',
    threadId: 'thread-1',
    userId: 'user-1',
    workspaceKey: 'snatch',
    agentProfileKey: 'build',
    ownerWorkerId: 'worker-a',
    ownerWorkerLabel: 'Worker A',
    workerClaimedAt: '2026-01-01T00:00:00.000Z',
    status: 'active',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('resolveAgentSessionOwnerMailboxRoute', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hoisted.loadAgentCommandMetadata.mockResolvedValue({
      aggregated: {
        liveWorkers: [],
      },
    });
    hoisted.updateAgentSessionOwnership.mockResolvedValue(undefined);
  });

  it('marks the owner stale when the owner worker is no longer live', async () => {
    hoisted.updateAgentSessionOwnership.mockResolvedValue({
      ...buildSession(),
      ownerStaleSince: '2026-01-01T00:10:00.000Z',
    });

    const result = await resolveAgentSessionOwnerMailboxRoute(buildSession());

    expect(result.ok).toBe(false);
    expect(hoisted.loadAgentCommandMetadata).toHaveBeenCalledWith({ forceRefresh: true });
    expect(hoisted.updateAgentSessionOwnership).toHaveBeenCalledWith(
      'session-1',
      expect.objectContaining({
        ownerWorkerId: 'worker-a',
        ownerWorkerLabel: 'Worker A',
        workerClaimedAt: '2026-01-01T00:00:00.000Z',
      }),
    );
    expect(result).toMatchObject({
      errorMessage: 'This agent session is waiting for owner worker Worker A (worker-a) to return.',
    });
    expect(result.session).toMatchObject({
      ownerStaleSince: '2026-01-01T00:10:00.000Z',
    });
  });

  it('clears stale-owner state when the owner worker is live again', async () => {
    hoisted.loadAgentCommandMetadata.mockResolvedValue({
      aggregated: {
        liveWorkers: [
          {
            workerId: 'worker-a',
            workerLabel: 'Worker A',
          },
        ],
      },
    });
    hoisted.updateAgentSessionOwnership.mockResolvedValue({
      ...buildSession(),
      ownerStaleSince: undefined,
    });

    const result = await resolveAgentSessionOwnerMailboxRoute(
      buildSession({ ownerStaleSince: '2026-01-01T00:10:00.000Z' }),
    );

    expect(result).toMatchObject({
      ok: true,
      targetWorkerId: 'worker-a',
    });
    expect(hoisted.updateAgentSessionOwnership).toHaveBeenCalledWith('session-1', {
      ownerWorkerId: 'worker-a',
      ownerWorkerLabel: 'Worker A',
      workerClaimedAt: '2026-01-01T00:00:00.000Z',
      ownerStaleSince: undefined,
    });
  });
});
