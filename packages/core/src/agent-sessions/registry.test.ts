import { afterEach, describe, expect, it } from 'vitest';
import { closeJobRegistryDb, getJobRegistryDb } from '../db/index.js';
import { resetConfigCaches } from '../config/env.js';
import { applyRequiredEnv } from '../../tests/helpers/env.js';
import {
  createAgentSession,
  findAgentSessionByThread,
  findDiscordAgentSessionByThread,
  loadAgentSession,
  updateAgentSessionCodingAgentSessionId,
  updateAgentSessionStatus,
} from './registry.js';

describe('agent session registry', () => {
  afterEach(async () => {
    await closeJobRegistryDb();
    resetConfigCaches();
  });

  async function ensureAgentSessionsTable() {
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
          'status text NOT NULL,',
          'created_at text NOT NULL,',
          'updated_at text NOT NULL',
          ')',
        ].join(' '),
      )
      .run();
  }

  it('creates, loads, finds, and updates sqlite agent sessions', async () => {
    applyRequiredEnv({ JOB_REGISTRY_DB: 'sqlite' });
    await ensureAgentSessionsTable();

    const created = await createAgentSession({
      sessionId: 'session-1',
      provider: 'discord',
      channelId: 'C1',
      threadId: 'T1',
      userId: 'U1',
      guildId: 'G1',
      workspaceKey: 'snatch',
      agentProfileKey: 'build',
      cwd: 'apps/worker',
      status: 'pending',
      now: new Date('2026-01-01T00:00:00.000Z'),
    });

    expect(created.status).toBe('pending');
    await expect(loadAgentSession('session-1')).resolves.toMatchObject({
      sessionId: 'session-1',
      threadId: 'T1',
      workspaceKey: 'snatch',
    });
    await expect(findDiscordAgentSessionByThread('T1')).resolves.toMatchObject({
      sessionId: 'session-1',
    });
    await expect(
      findAgentSessionByThread({ provider: 'discord', threadId: 'T1' }),
    ).resolves.toMatchObject({
      sessionId: 'session-1',
    });

    const updated = await updateAgentSessionStatus('session-1', 'active');
    expect(updated?.status).toBe('active');
    const withCodingAgentSession = await updateAgentSessionCodingAgentSessionId(
      'session-1',
      'opencode-session-1',
    );
    expect(withCodingAgentSession?.codingAgentSessionId).toBe('opencode-session-1');
    await expect(loadAgentSession('session-1')).resolves.toMatchObject({
      status: 'active',
      codingAgentSessionId: 'opencode-session-1',
    });
  });

  it('stores and finds slack agent sessions by provider and thread', async () => {
    applyRequiredEnv({ JOB_REGISTRY_DB: 'sqlite' });
    await ensureAgentSessionsTable();

    await createAgentSession({
      sessionId: 'session-slack-1',
      provider: 'slack',
      channelId: 'C1',
      threadId: '1740000000.123',
      userId: 'U1',
      workspaceId: 'T1',
      workspaceKey: 'snatch',
      agentProfileKey: 'build',
      status: 'pending',
      now: new Date('2026-01-01T00:00:00.000Z'),
    });

    await expect(loadAgentSession('session-slack-1')).resolves.toMatchObject({
      provider: 'slack',
      workspaceId: 'T1',
    });
    await expect(
      findAgentSessionByThread({ provider: 'slack', threadId: '1740000000.123' }),
    ).resolves.toMatchObject({
      sessionId: 'session-slack-1',
      provider: 'slack',
    });
  });

  it('rejects pg and redis drivers for now', async () => {
    applyRequiredEnv({
      JOB_REGISTRY_DB: 'pg',
      JOB_REGISTRY_PG_URL: 'postgres://user:pass@localhost:5432/sniptail',
    });
    await expect(loadAgentSession('session-1')).rejects.toThrow(
      'Agent session registry is not supported yet when JOB_REGISTRY_DB=pg',
    );
    resetConfigCaches();

    applyRequiredEnv({
      JOB_REGISTRY_DB: 'redis',
      JOB_REGISTRY_REDIS_URL: 'redis://localhost:6379/1',
    });
    await expect(loadAgentSession('session-1')).rejects.toThrow(
      'Agent session registry is not supported yet when JOB_REGISTRY_DB=redis',
    );
  });
});
