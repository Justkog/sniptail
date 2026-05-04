import { afterEach, describe, expect, it } from 'vitest';
import { closeJobRegistryDb, getJobRegistryDb } from '../db/index.js';
import { resetConfigCaches } from '../config/env.js';
import { applyRequiredEnv } from '../../tests/helpers/env.js';
import { loadDiscordAgentDefaults, upsertDiscordAgentDefaults } from './registry.js';

describe('agent default registry', () => {
  afterEach(async () => {
    await closeJobRegistryDb();
    resetConfigCaches();
  });

  async function ensureAgentDefaultsTable() {
    const client = await getJobRegistryDb();
    if (client.kind !== 'sqlite') {
      throw new Error('Expected sqlite client in test');
    }
    client.raw
      .prepare(
        [
          'CREATE TABLE IF NOT EXISTS agent_defaults (',
          'scope_key text PRIMARY KEY,',
          'provider text NOT NULL,',
          'user_id text NOT NULL,',
          'guild_id text,',
          'workspace_key text NOT NULL,',
          'agent_profile_key text NOT NULL,',
          'cwd text,',
          'created_at text NOT NULL,',
          'updated_at text NOT NULL',
          ')',
        ].join(' '),
      )
      .run();
  }

  it('loads and upserts per-guild discord defaults', async () => {
    applyRequiredEnv({ JOB_REGISTRY_DB: 'sqlite' });
    await ensureAgentDefaultsTable();

    const created = await upsertDiscordAgentDefaults({
      userId: 'U1',
      guildId: 'G1',
      workspaceKey: 'snatch',
      agentProfileKey: 'build',
      cwd: 'apps/worker',
      now: new Date('2026-01-01T00:00:00.000Z'),
    });

    expect(created.workspaceKey).toBe('snatch');
    await expect(loadDiscordAgentDefaults({ userId: 'U1', guildId: 'G1' })).resolves.toMatchObject({
      workspaceKey: 'snatch',
      agentProfileKey: 'build',
      cwd: 'apps/worker',
    });

    const updated = await upsertDiscordAgentDefaults({
      userId: 'U1',
      guildId: 'G1',
      workspaceKey: 'tools',
      agentProfileKey: 'plan',
      now: new Date('2026-01-02T00:00:00.000Z'),
    });

    expect(updated.createdAt).toBe('2026-01-01T00:00:00.000Z');
    expect(updated.updatedAt).toBe('2026-01-02T00:00:00.000Z');
    await expect(loadDiscordAgentDefaults({ userId: 'U1', guildId: 'G1' })).resolves.toMatchObject({
      workspaceKey: 'tools',
      agentProfileKey: 'plan',
    });
    await expect(loadDiscordAgentDefaults({ userId: 'U1' })).resolves.toBeUndefined();
  });

  it('rejects pg and redis drivers for now', async () => {
    applyRequiredEnv({
      JOB_REGISTRY_DB: 'pg',
      JOB_REGISTRY_PG_URL: 'postgres://user:pass@localhost:5432/sniptail',
    });
    await expect(loadDiscordAgentDefaults({ userId: 'U1', guildId: 'G1' })).rejects.toThrow(
      'Agent default registry is not supported yet when JOB_REGISTRY_DB=pg',
    );
    resetConfigCaches();

    applyRequiredEnv({
      JOB_REGISTRY_DB: 'redis',
      JOB_REGISTRY_REDIS_URL: 'redis://localhost:6379/1',
    });
    await expect(loadDiscordAgentDefaults({ userId: 'U1', guildId: 'G1' })).rejects.toThrow(
      'Agent default registry is not supported yet when JOB_REGISTRY_DB=redis',
    );
  });
});
