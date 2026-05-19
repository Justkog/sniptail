import { afterEach, describe, expect, it } from 'vitest';
import { agentSessionIndexKey, agentSessionKey } from '../registry/redisRegistryKeys.js';
import { createRedisAgentSessionStore } from './redisStore.js';

class FakeRedisClient {
  private readonly values = new Map<string, string>();
  private readonly sets = new Map<string, Set<string>>();

  reset() {
    this.values.clear();
    this.sets.clear();
  }

  get(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  mget(...keys: string[]): Array<string | null> {
    return keys.map((key) => this.values.get(key) ?? null);
  }

  set(key: string, value: string): 'OK' {
    this.values.set(key, value);
    return 'OK';
  }

  del(...keys: string[]): number {
    let deleted = 0;
    for (const key of keys) {
      if (this.values.delete(key)) {
        deleted += 1;
      }
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

    if (script.includes('-- sniptail:update-agent-session-status')) {
      parsed.record.status = values[0];
      parsed.record.updatedAt = values[1];
      this.values.set(sessionKey, JSON.stringify(parsed));
      return 1;
    }

    if (script.includes('-- sniptail:update-agent-session-coding-id')) {
      parsed.record.codingAgentSessionId = values[0];
      parsed.record.updatedAt = values[1];
      this.values.set(sessionKey, JSON.stringify(parsed));
      return 1;
    }

    if (script.includes('-- sniptail:update-agent-session-ownership-record')) {
      parsed.record.ownerWorkerId = values[0] ? values[0] : undefined;
      parsed.record.ownerWorkerLabel = values[1] ? values[1] : undefined;
      parsed.record.workerClaimedAt = values[2] ? values[2] : undefined;
      parsed.record.ownerStaleSince = values[3] ? values[3] : undefined;
      parsed.record.updatedAt = values[4];
      this.values.set(sessionKey, JSON.stringify(parsed));
      return 1;
    }

    throw new Error(`Unexpected redis eval script in test: ${script}`);
  }
}

describe('redis agent session store', () => {
  const client = new FakeRedisClient();

  afterEach(() => {
    client.reset();
  });

  it('creates, loads, finds, and updates redis agent sessions', async () => {
    const store = createRedisAgentSessionStore('redis://unused', {
      namespace: 'test',
      client,
    });

    const created = await store.createSession({
      sessionId: 'session-1',
      provider: 'discord',
      channelId: 'C1',
      threadId: 'T1',
      userId: 'U1',
      workspaceKey: 'snatch',
      agentProfileKey: 'build',
      cwd: 'apps/worker',
      ownerWorkerId: 'worker-a',
      ownerWorkerLabel: 'Worker A',
      workerClaimedAt: '2026-05-15T10:01:00.000Z',
      status: 'pending',
      now: new Date('2026-05-15T10:00:00.000Z'),
    });

    expect(created).toMatchObject({
      ownerWorkerId: 'worker-a',
      ownerWorkerLabel: 'Worker A',
      workerClaimedAt: '2026-05-15T10:01:00.000Z',
    });
    expect(client.smembers(agentSessionIndexKey('test'))).toEqual(['session-1']);

    await store.createSession({
      sessionId: 'session-2',
      provider: 'discord',
      channelId: 'C2',
      threadId: 'T1',
      userId: 'U2',
      workspaceKey: 'snatch',
      agentProfileKey: 'build',
      status: 'active',
      now: new Date('2026-05-15T10:02:00.000Z'),
    });

    await expect(store.loadSession('session-1')).resolves.toMatchObject({
      sessionId: 'session-1',
      ownerWorkerId: 'worker-a',
    });
    await expect(
      store.findSessionByThread({ provider: 'discord', threadId: 'T1' }),
    ).resolves.toMatchObject({
      sessionId: 'session-2',
    });

    const updatedStatus = await store.updateSessionStatus('session-1', 'active');
    expect(updatedStatus).toMatchObject({
      status: 'active',
      ownerWorkerId: 'worker-a',
    });

    const updatedCodingId = await store.updateCodingAgentSessionId('session-1', 'codex-session-1');
    expect(updatedCodingId).toMatchObject({
      codingAgentSessionId: 'codex-session-1',
      ownerWorkerId: 'worker-a',
    });

    const updatedOwnership = await store.updateSessionOwnership('session-1', {
      ownerWorkerId: 'worker-b',
      ownerWorkerLabel: 'Worker B',
      workerClaimedAt: '2026-05-15T10:03:00.000Z',
      ownerStaleSince: '2026-05-15T10:04:00.000Z',
    });
    expect(updatedOwnership).toMatchObject({
      status: 'active',
      codingAgentSessionId: 'codex-session-1',
      ownerWorkerId: 'worker-b',
      ownerWorkerLabel: 'Worker B',
      workerClaimedAt: '2026-05-15T10:03:00.000Z',
      ownerStaleSince: '2026-05-15T10:04:00.000Z',
    });
  });

  it('returns undefined when redis updates target a missing session', async () => {
    const store = createRedisAgentSessionStore('redis://unused', {
      namespace: 'test',
      client,
    });

    await expect(store.updateSessionStatus('missing', 'active')).resolves.toBeUndefined();
    await expect(
      store.updateCodingAgentSessionId('missing', 'codex-session'),
    ).resolves.toBeUndefined();
    await expect(
      store.updateSessionOwnership('missing', {
        ownerWorkerId: 'worker-a',
      }),
    ).resolves.toBeUndefined();
  });

  it('cleans stale session index entries during thread lookup', async () => {
    const store = createRedisAgentSessionStore('redis://unused', {
      namespace: 'test',
      client,
    });

    client.sadd(agentSessionIndexKey('test'), 'session-1', 'session-missing');
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

    await expect(
      store.findSessionByThread({ provider: 'discord', threadId: 'T1' }),
    ).resolves.toMatchObject({
      sessionId: 'session-1',
    });
    expect(client.smembers(agentSessionIndexKey('test'))).toEqual(['session-1']);
  });
});
