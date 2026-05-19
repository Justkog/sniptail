import { afterEach, describe, expect, it } from 'vitest';
import {
  agentSessionIndexKey,
  agentSessionKey,
  workerCapabilityIndexKey,
  workerCapabilityKey,
  workerHeartbeatKey,
} from './redisRegistryKeys.js';
import {
  createRedisAgentSessionOwnershipRegistryStore,
  createRedisWorkerCapabilityRegistryStore,
} from './redisRegistryStores.js';

class FakeRedisClient {
  private readonly values = new Map<string, string>();
  private readonly sets = new Map<string, Set<string>>();
  private readonly ttls = new Map<string, number>();

  reset() {
    this.values.clear();
    this.sets.clear();
    this.ttls.clear();
  }

  get(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  mget(...keys: string[]): Array<string | null> {
    return keys.map((key) => this.values.get(key) ?? null);
  }

  set(key: string, value: string, ...args: string[]): 'OK' {
    this.values.set(key, value);
    if (args[0] === 'PX' && args[1]) {
      this.ttls.set(key, Number(args[1]));
    }
    return 'OK';
  }

  del(...keys: string[]): number {
    let deleted = 0;
    for (const key of keys) {
      if (this.values.delete(key)) {
        deleted += 1;
      }
      this.ttls.delete(key);
    }
    return deleted;
  }

  sadd(key: string, ...members: string[]): number {
    const set = this.sets.get(key) ?? new Set<string>();
    this.sets.set(key, set);
    let added = 0;
    for (const member of members) {
      if (!set.has(member)) {
        set.add(member);
        added += 1;
      }
    }
    return added;
  }

  srem(key: string, ...members: string[]): number {
    const set = this.sets.get(key);
    if (!set) return 0;
    let removed = 0;
    for (const member of members) {
      if (set.delete(member)) {
        removed += 1;
      }
    }
    return removed;
  }

  smembers(key: string): string[] {
    return [...(this.sets.get(key) ?? new Set<string>())];
  }

  eval(script: string, numkeys: number, ...args: string[]): unknown {
    const keys = args.slice(0, numkeys);
    const values = args.slice(numkeys);

    if (script.includes('-- sniptail:refresh-worker-heartbeat')) {
      const capabilityKey = keys[0];
      const heartbeatKey = keys[1];
      if (!capabilityKey || !heartbeatKey) {
        throw new Error('Missing redis capability keys in test');
      }
      const raw = this.values.get(capabilityKey);
      if (!raw) {
        return 0;
      }
      const parsed = JSON.parse(raw) as { version?: number; record?: Record<string, unknown> };
      if (parsed.version !== 1 || !parsed.record) {
        return -1;
      }
      parsed.record.workerLabel = values[0] ? values[0] : undefined;
      parsed.record.startedAt = values[1];
      parsed.record.lastSeenAt = values[2];
      parsed.record.activeRuntimeCount = values[3] ? Number(values[3]) : undefined;
      parsed.record.maxActiveSessions = values[4] ? Number(values[4]) : undefined;
      this.values.set(capabilityKey, JSON.stringify(parsed));
      this.values.set(heartbeatKey, values[5] ?? '');
      this.ttls.set(heartbeatKey, Number(values[6] ?? 0));
      return 1;
    }

    if (script.includes('-- sniptail:update-session-ownership')) {
      const sessionKey = keys[0];
      if (!sessionKey) {
        throw new Error('Missing redis session key in test');
      }
      const raw = this.values.get(sessionKey);
      if (!raw) {
        return 0;
      }
      const parsed = JSON.parse(raw) as { version?: number; record?: Record<string, unknown> };
      if (parsed.version !== 1 || !parsed.record) {
        return -1;
      }
      parsed.record.ownerWorkerId = values[0] ? values[0] : undefined;
      parsed.record.ownerWorkerLabel = values[1] ? values[1] : undefined;
      parsed.record.workerClaimedAt = values[2] ? values[2] : undefined;
      parsed.record.ownerStaleSince = values[3] ? values[3] : undefined;
      this.values.set(sessionKey, JSON.stringify(parsed));
      return 1;
    }

    throw new Error(`Unexpected redis eval script in test: ${script}`);
  }

  getValue(key: string): string | undefined {
    return this.values.get(key);
  }

  getTtl(key: string): number | undefined {
    return this.ttls.get(key);
  }
}

describe('redis registry stores', () => {
  const client = new FakeRedisClient();

  afterEach(() => {
    client.reset();
  });

  it('upserts, lists, refreshes, and deletes worker capabilities', async () => {
    const store = createRedisWorkerCapabilityRegistryStore('redis://unused', {
      namespace: 'test',
      workerHeartbeatTtlMs: 120_000,
      client,
    });

    await store.upsertWorkerCapability({
      workerId: 'worker-b',
      workerLabel: 'Worker B',
      enabled: true,
      workspaces: [{ key: 'snatch', label: 'Snatch', description: 'Main checkout' }],
      profiles: [{ key: 'build', provider: 'codex', profile: 'default' }],
      activeRuntimeCount: 2,
      maxActiveSessions: 4,
      startedAt: '2026-05-15T10:00:00.000Z',
      lastSeenAt: '2026-05-15T10:00:10.000Z',
    });
    await store.upsertWorkerCapability({
      workerId: 'worker-a',
      enabled: false,
      workspaces: [{ key: 'tools' }],
      profiles: [{ key: 'plan', provider: 'copilot', profile: 'planner' }],
      startedAt: '2026-05-15T09:00:00.000Z',
      lastSeenAt: '2026-05-15T09:00:10.000Z',
    });

    await expect(store.loadWorkerCapability('worker-b')).resolves.toEqual({
      workerId: 'worker-b',
      workerLabel: 'Worker B',
      enabled: true,
      workspaces: [{ key: 'snatch', label: 'Snatch', description: 'Main checkout' }],
      profiles: [{ key: 'build', provider: 'codex', profile: 'default' }],
      activeRuntimeCount: 2,
      maxActiveSessions: 4,
      startedAt: '2026-05-15T10:00:00.000Z',
      lastSeenAt: '2026-05-15T10:00:10.000Z',
    });

    expect(client.getTtl(workerHeartbeatKey('test', 'worker-b'))).toBe(120_000);
    await expect(store.listWorkerCapabilities()).resolves.toMatchObject([
      { workerId: 'worker-a', enabled: false },
      { workerId: 'worker-b', enabled: true },
    ]);

    await store.refreshWorkerHeartbeat({
      workerId: 'worker-b',
      workerLabel: 'Worker Bee',
      startedAt: '2026-05-15T10:00:00.000Z',
      lastSeenAt: '2026-05-15T10:00:30.000Z',
      activeRuntimeCount: 3,
      maxActiveSessions: 5,
    });

    await expect(store.loadWorkerCapability('worker-b')).resolves.toEqual({
      workerId: 'worker-b',
      workerLabel: 'Worker Bee',
      enabled: true,
      workspaces: [{ key: 'snatch', label: 'Snatch', description: 'Main checkout' }],
      profiles: [{ key: 'build', provider: 'codex', profile: 'default' }],
      activeRuntimeCount: 3,
      maxActiveSessions: 5,
      startedAt: '2026-05-15T10:00:00.000Z',
      lastSeenAt: '2026-05-15T10:00:30.000Z',
    });

    await store.deleteWorkerCapability('worker-a');
    await expect(store.listWorkerCapabilities()).resolves.toMatchObject([{ workerId: 'worker-b' }]);
    expect(client.getValue(workerCapabilityKey('test', 'worker-a'))).toBeUndefined();
    expect(client.smembers(workerCapabilityIndexKey('test')).sort()).toEqual(['worker-b']);
  });

  it('rejects heartbeat refresh before capability registration', async () => {
    const store = createRedisWorkerCapabilityRegistryStore('redis://unused', {
      namespace: 'test',
      client,
    });

    await expect(
      store.refreshWorkerHeartbeat({
        workerId: 'worker-missing',
        startedAt: '2026-05-15T10:00:00.000Z',
        lastSeenAt: '2026-05-15T10:00:10.000Z',
      }),
    ).rejects.toThrow('Cannot refresh worker heartbeat before capability registration');
  });

  it('skips malformed payloads and cleans missing capability index entries', async () => {
    const store = createRedisWorkerCapabilityRegistryStore('redis://unused', {
      namespace: 'test',
      client,
    });

    client.sadd(workerCapabilityIndexKey('test'), 'worker-a', 'worker-b', 'worker-c');
    client.set(
      workerCapabilityKey('test', 'worker-a'),
      JSON.stringify({
        version: 1,
        record: {
          workerId: 'worker-a',
          enabled: true,
          workspaces: [{ key: 'snatch' }],
          profiles: [{ key: 'build', provider: 'codex' }],
          startedAt: '2026-05-15T10:00:00.000Z',
          lastSeenAt: '2026-05-15T10:00:10.000Z',
        },
      }),
    );
    client.set(workerCapabilityKey('test', 'worker-b'), '{"version":99}');

    await expect(store.listWorkerCapabilities()).resolves.toEqual([
      {
        workerId: 'worker-a',
        enabled: true,
        workspaces: [{ key: 'snatch' }],
        profiles: [{ key: 'build', provider: 'codex' }],
        startedAt: '2026-05-15T10:00:00.000Z',
        lastSeenAt: '2026-05-15T10:00:10.000Z',
      },
    ]);
    expect(client.smembers(workerCapabilityIndexKey('test')).sort()).toEqual([
      'worker-a',
      'worker-b',
    ]);
  });

  it('loads and updates session ownership and derives active counts from sessions', async () => {
    const store = createRedisAgentSessionOwnershipRegistryStore('redis://unused', {
      namespace: 'test',
      client,
    });

    client.sadd(agentSessionIndexKey('test'), 'session-1', 'session-2', 'session-3', 'session-4');
    client.set(
      agentSessionKey('test', 'session-1'),
      JSON.stringify({
        version: 1,
        record: {
          sessionId: 'session-1',
          provider: 'discord',
          channelId: 'C1',
          threadId: 'T1',
          userId: 'U1',
          workspaceKey: 'snatch',
          agentProfileKey: 'build',
          status: 'pending',
          createdAt: '2026-05-15T10:00:00.000Z',
          updatedAt: '2026-05-15T10:00:00.000Z',
        },
      }),
    );
    client.set(
      agentSessionKey('test', 'session-2'),
      JSON.stringify({
        version: 1,
        record: {
          sessionId: 'session-2',
          provider: 'discord',
          channelId: 'C1',
          threadId: 'T2',
          userId: 'U1',
          workspaceKey: 'snatch',
          agentProfileKey: 'build',
          ownerWorkerId: 'worker-b',
          ownerWorkerLabel: 'Worker B',
          workerClaimedAt: '2026-05-15T10:01:00.000Z',
          ownerStaleSince: '2026-05-15T10:02:00.000Z',
          status: 'active',
          createdAt: '2026-05-15T10:00:00.000Z',
          updatedAt: '2026-05-15T10:00:00.000Z',
        },
      }),
    );
    client.set(
      agentSessionKey('test', 'session-3'),
      JSON.stringify({
        version: 1,
        record: {
          sessionId: 'session-3',
          provider: 'discord',
          channelId: 'C1',
          threadId: 'T3',
          userId: 'U1',
          workspaceKey: 'snatch',
          agentProfileKey: 'build',
          ownerWorkerId: 'worker-b',
          status: 'completed',
          createdAt: '2026-05-15T10:00:00.000Z',
          updatedAt: '2026-05-15T10:00:00.000Z',
        },
      }),
    );
    client.set(
      agentSessionKey('test', 'session-4'),
      JSON.stringify({
        version: 1,
        record: {
          sessionId: 'session-4',
          provider: 'discord',
          channelId: 'C1',
          threadId: 'T4',
          userId: 'U1',
          workspaceKey: 'snatch',
          agentProfileKey: 'build',
          ownerWorkerId: 'worker-a',
          status: 'active',
          createdAt: '2026-05-15T10:00:00.000Z',
          updatedAt: '2026-05-15T10:00:00.000Z',
        },
      }),
    );

    await expect(store.loadSessionOwnership('session-1')).resolves.toEqual({
      sessionId: 'session-1',
    });

    await store.updateSessionOwnership({
      sessionId: 'session-1',
      ownerWorkerId: 'worker-a',
      ownerWorkerLabel: 'Worker A',
      workerClaimedAt: '2026-05-15T10:05:00.000Z',
    });

    await expect(store.loadSessionOwnership('session-1')).resolves.toEqual({
      sessionId: 'session-1',
      ownerWorkerId: 'worker-a',
      ownerWorkerLabel: 'Worker A',
      workerClaimedAt: '2026-05-15T10:05:00.000Z',
    });

    await expect(
      store.listActiveSessionCountsByWorkerIds(['worker-a', 'worker-b', 'worker-c']),
    ).resolves.toEqual({
      'worker-a': 2,
      'worker-b': 1,
      'worker-c': 0,
    });
  });

  it('rejects ownership updates for unknown sessions', async () => {
    const store = createRedisAgentSessionOwnershipRegistryStore('redis://unused', {
      namespace: 'test',
      client,
    });

    await expect(
      store.updateSessionOwnership({
        sessionId: 'missing-session',
        ownerWorkerId: 'worker-a',
      }),
    ).rejects.toThrow('Agent session "missing-session" was not found.');
  });
});
