import { describe, expect, it, vi } from 'vitest';
import { createPgAgentSessionStore } from './pgStore.js';

type AgentSessionRow = {
  sessionId: string;
  provider: 'discord' | 'slack';
  channelId: string;
  threadId: string;
  userId: string;
  guildId: string | null;
  workspaceId: string | null;
  workspaceKey: string;
  agentProfileKey: string;
  codingAgentSessionId: string | null;
  cwd: string | null;
  ownerWorkerId: string | null;
  ownerWorkerLabel: string | null;
  workerClaimedAt: string | null;
  ownerStaleSince: string | null;
  status: string;
  createdAt: string;
  updatedAt: string;
};

function buildRow(overrides: Partial<AgentSessionRow> = {}): AgentSessionRow {
  return {
    sessionId: 'session-1',
    provider: 'discord',
    channelId: 'C1',
    threadId: 'T1',
    userId: 'U1',
    guildId: 'G1',
    workspaceId: null,
    workspaceKey: 'snatch',
    agentProfileKey: 'build',
    codingAgentSessionId: null,
    cwd: 'apps/worker',
    ownerWorkerId: 'worker-a',
    ownerWorkerLabel: 'Worker A',
    workerClaimedAt: '2026-05-15T10:01:00.000Z',
    ownerStaleSince: null,
    status: 'pending',
    createdAt: '2026-05-15T10:00:00.000Z',
    updatedAt: '2026-05-15T10:00:00.000Z',
    ...overrides,
  };
}

function createSelectChain(result: unknown[]) {
  const chain = {
    from: vi.fn(),
    where: vi.fn(),
    orderBy: vi.fn(),
    limit: vi.fn(),
  };
  chain.from.mockReturnValue(chain);
  chain.where.mockReturnValue(chain);
  chain.orderBy.mockReturnValue(chain);
  chain.limit.mockResolvedValue(result);
  return chain;
}

function createUpdateChain(returningRows: unknown[] = []) {
  const chain = {
    set: vi.fn(),
    where: vi.fn(),
    returning: vi.fn(),
  };
  chain.set.mockReturnValue(chain);
  chain.where.mockReturnValue(chain);
  chain.returning.mockResolvedValue(returningRows);
  return chain;
}

describe('pg agent session store', () => {
  it('creates sessions with owner fields in postgres', async () => {
    const onConflictDoUpdate = vi.fn().mockResolvedValue(undefined);
    const values = vi.fn(() => ({ onConflictDoUpdate }));
    const insert = vi.fn(() => ({ values }));
    const client = {
      db: {
        insert,
      },
    } as const;

    const store = createPgAgentSessionStore(client as never);
    const record = await store.createSession({
      sessionId: 'session-1',
      provider: 'discord',
      channelId: 'C1',
      threadId: 'T1',
      userId: 'U1',
      guildId: 'G1',
      workspaceKey: 'snatch',
      agentProfileKey: 'build',
      cwd: 'apps/worker',
      ownerWorkerId: 'worker-a',
      ownerWorkerLabel: 'Worker A',
      workerClaimedAt: '2026-05-15T10:01:00.000Z',
      status: 'pending',
      now: new Date('2026-05-15T10:00:00.000Z'),
    });

    expect(values).toHaveBeenCalledWith(
      expect.objectContaining({
        ownerWorkerId: 'worker-a',
        ownerWorkerLabel: 'Worker A',
        workerClaimedAt: '2026-05-15T10:01:00.000Z',
        ownerStaleSince: null,
      }),
    );
    expect(onConflictDoUpdate).toHaveBeenCalled();
    expect(record).toMatchObject({
      ownerWorkerId: 'worker-a',
      ownerWorkerLabel: 'Worker A',
      workerClaimedAt: '2026-05-15T10:01:00.000Z',
    });
  });

  it('loads, finds, and updates sessions while preserving owner fields', async () => {
    const selectChains = [
      createSelectChain([buildRow()]),
      createSelectChain([
        buildRow({ sessionId: 'session-2', threadId: 'T2', updatedAt: '2026-05-15T10:02:00.000Z' }),
      ]),
      createSelectChain([buildRow({ status: 'pending' })]),
      createSelectChain([buildRow({ codingAgentSessionId: null })]),
      createSelectChain([buildRow({ ownerWorkerId: 'worker-a', ownerWorkerLabel: 'Worker A' })]),
    ];
    const updateChains = [createUpdateChain(), createUpdateChain(), createUpdateChain()];
    const client = {
      db: {
        select: vi
          .fn()
          .mockImplementationOnce(() => selectChains[0])
          .mockImplementationOnce(() => selectChains[1])
          .mockImplementationOnce(() => selectChains[2])
          .mockImplementationOnce(() => selectChains[3])
          .mockImplementationOnce(() => selectChains[4]),
        update: vi
          .fn()
          .mockImplementationOnce(() => updateChains[0])
          .mockImplementationOnce(() => updateChains[1])
          .mockImplementationOnce(() => updateChains[2]),
      },
    } as const;

    const store = createPgAgentSessionStore(client as never);

    await expect(store.loadSession('session-1')).resolves.toMatchObject({
      ownerWorkerId: 'worker-a',
      ownerWorkerLabel: 'Worker A',
    });
    await expect(
      store.findSessionByThread({ provider: 'discord', threadId: 'T2' }),
    ).resolves.toMatchObject({
      sessionId: 'session-2',
      ownerWorkerId: 'worker-a',
    });

    const updatedStatus = await store.updateSessionStatus('session-1', 'active');
    expect(updatedStatus).toMatchObject({
      status: 'active',
      ownerWorkerId: 'worker-a',
    });

    const updatedCodingId = await store.updateCodingAgentSessionId('session-1', 'codex-session-9');
    expect(updatedCodingId).toMatchObject({
      codingAgentSessionId: 'codex-session-9',
      ownerWorkerId: 'worker-a',
    });

    const updatedOwnership = await store.updateSessionOwnership('session-1', {
      ownerWorkerId: 'worker-b',
      ownerWorkerLabel: 'Worker B',
      workerClaimedAt: '2026-05-15T10:03:00.000Z',
      ownerStaleSince: '2026-05-15T10:04:00.000Z',
    });
    expect(updatedOwnership).toMatchObject({
      ownerWorkerId: 'worker-b',
      ownerWorkerLabel: 'Worker B',
      workerClaimedAt: '2026-05-15T10:03:00.000Z',
      ownerStaleSince: '2026-05-15T10:04:00.000Z',
    });

    expect(updateChains[0].set).toHaveBeenCalledWith(expect.objectContaining({ status: 'active' }));
    expect(updateChains[1].set).toHaveBeenCalledWith(
      expect.objectContaining({ codingAgentSessionId: 'codex-session-9' }),
    );
    expect(updateChains[2].set).toHaveBeenCalledWith(
      expect.objectContaining({
        ownerWorkerId: 'worker-b',
        ownerWorkerLabel: 'Worker B',
        workerClaimedAt: '2026-05-15T10:03:00.000Z',
        ownerStaleSince: '2026-05-15T10:04:00.000Z',
      }),
    );
  });
});
