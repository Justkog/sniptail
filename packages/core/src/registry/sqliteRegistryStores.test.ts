import { afterEach, describe, expect, it } from 'vitest';
import { closeJobRegistryDb, getJobRegistryDb } from '../db/index.js';
import { resetConfigCaches } from '../config/env.js';
import { applyRequiredEnv } from '../../tests/helpers/env.js';
import {
  createSqliteAgentSessionOwnershipRegistryStore,
  createSqliteWorkerCapabilityRegistryStore,
} from './sqliteRegistryStores.js';

describe('sqlite registry stores', () => {
  afterEach(async () => {
    await closeJobRegistryDb();
    resetConfigCaches();
  });

  async function ensureRegistryTables() {
    const client = await getJobRegistryDb();
    if (client.kind !== 'sqlite') {
      throw new Error('Expected sqlite client in test');
    }
    client.raw
      .prepare(
        [
          'CREATE TABLE IF NOT EXISTS agent_sessions (',
          'session_id text PRIMARY KEY,',
          'provider text NOT NULL,',
          'channel_id text NOT NULL,',
          'thread_id text NOT NULL,',
          'user_id text NOT NULL,',
          'guild_id text,',
          'workspace_id text,',
          'workspace_key text NOT NULL,',
          'agent_profile_key text NOT NULL,',
          'coding_agent_session_id text,',
          'cwd text,',
          'owner_worker_id text,',
          'owner_worker_label text,',
          'worker_claimed_at text,',
          'owner_stale_since text,',
          'status text NOT NULL,',
          'created_at text NOT NULL,',
          'updated_at text NOT NULL',
          ')',
        ].join(' '),
      )
      .run();
    client.raw
      .prepare(
        [
          'CREATE TABLE IF NOT EXISTS worker_agent_capabilities (',
          'worker_id text PRIMARY KEY,',
          'worker_label text,',
          'enabled integer NOT NULL,',
          'capability_json text NOT NULL,',
          'started_at text NOT NULL,',
          'last_seen_at text NOT NULL,',
          'active_runtime_count integer,',
          'max_active_sessions integer',
          ')',
        ].join(' '),
      )
      .run();
    return client;
  }

  it('upserts, lists, refreshes, and deletes worker capabilities', async () => {
    applyRequiredEnv({ SNIPTAIL_REGISTRY_DB: 'sqlite' });
    const client = await ensureRegistryTables();
    const store = createSqliteWorkerCapabilityRegistryStore(client);

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
  });

  it('rejects heartbeat refresh before capability registration', async () => {
    applyRequiredEnv({ SNIPTAIL_REGISTRY_DB: 'sqlite' });
    const client = await ensureRegistryTables();
    const store = createSqliteWorkerCapabilityRegistryStore(client);

    await expect(
      store.refreshWorkerHeartbeat({
        workerId: 'worker-missing',
        startedAt: '2026-05-15T10:00:00.000Z',
        lastSeenAt: '2026-05-15T10:00:10.000Z',
      }),
    ).rejects.toThrow('Cannot refresh worker heartbeat before capability registration');
  });

  it('loads and updates session ownership and derives active counts from sessions', async () => {
    applyRequiredEnv({ SNIPTAIL_REGISTRY_DB: 'sqlite' });
    const client = await ensureRegistryTables();
    const store = createSqliteAgentSessionOwnershipRegistryStore(client);

    client.raw
      .prepare(
        [
          'INSERT INTO agent_sessions (',
          'session_id, provider, channel_id, thread_id, user_id, workspace_key, agent_profile_key,',
          'status, created_at, updated_at',
          ') VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        ].join(' '),
      )
      .run(
        'session-1',
        'discord',
        'C1',
        'T1',
        'U1',
        'snatch',
        'build',
        'pending',
        '2026-05-15T10:00:00.000Z',
        '2026-05-15T10:00:00.000Z',
      );
    client.raw
      .prepare(
        [
          'INSERT INTO agent_sessions (',
          'session_id, provider, channel_id, thread_id, user_id, workspace_key, agent_profile_key,',
          'owner_worker_id, owner_worker_label, worker_claimed_at, owner_stale_since,',
          'status, created_at, updated_at',
          ') VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        ].join(' '),
      )
      .run(
        'session-2',
        'discord',
        'C1',
        'T2',
        'U1',
        'snatch',
        'build',
        'worker-b',
        'Worker B',
        '2026-05-15T10:01:00.000Z',
        '2026-05-15T10:02:00.000Z',
        'active',
        '2026-05-15T10:00:00.000Z',
        '2026-05-15T10:00:00.000Z',
      );
    client.raw
      .prepare(
        [
          'INSERT INTO agent_sessions (',
          'session_id, provider, channel_id, thread_id, user_id, workspace_key, agent_profile_key,',
          'owner_worker_id, status, created_at, updated_at',
          ') VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        ].join(' '),
      )
      .run(
        'session-3',
        'discord',
        'C1',
        'T3',
        'U1',
        'snatch',
        'build',
        'worker-b',
        'completed',
        '2026-05-15T10:00:00.000Z',
        '2026-05-15T10:00:00.000Z',
      );
    client.raw
      .prepare(
        [
          'INSERT INTO agent_sessions (',
          'session_id, provider, channel_id, thread_id, user_id, workspace_key, agent_profile_key,',
          'owner_worker_id, status, created_at, updated_at',
          ') VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        ].join(' '),
      )
      .run(
        'session-4',
        'discord',
        'C1',
        'T4',
        'U1',
        'snatch',
        'build',
        'worker-a',
        'active',
        '2026-05-15T10:00:00.000Z',
        '2026-05-15T10:00:00.000Z',
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
    applyRequiredEnv({ SNIPTAIL_REGISTRY_DB: 'sqlite' });
    const client = await ensureRegistryTables();
    const store = createSqliteAgentSessionOwnershipRegistryStore(client);

    await expect(
      store.updateSessionOwnership({
        sessionId: 'missing-session',
        ownerWorkerId: 'worker-a',
      }),
    ).rejects.toThrow('Agent session "missing-session" was not found.');
  });
});
