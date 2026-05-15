import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { agentSessions, workerAgentCapabilities } from '../db/pg/schema.js';

function readRepoFile(relativePath: string): string {
  return readFileSync(join(process.cwd(), relativePath), 'utf8');
}

describe('pg registry migration', () => {
  it('tracks the worker registry migration in the journal', () => {
    const raw = readRepoFile('packages/core/drizzle/pg/meta/_journal.json');
    const journal = JSON.parse(raw) as {
      entries: Array<{ idx: number; tag: string }>;
    };

    expect(journal.entries[journal.entries.length - 1]).toMatchObject({
      idx: 3,
      tag: '0003_create_agent_session_and_worker_registry_state',
    });
  });

  it('defines the agent session and worker capability registry schema', () => {
    expect(agentSessions).toBeDefined();
    expect(workerAgentCapabilities).toBeDefined();
  });

  it('creates agent owner and worker capability state in postgres', () => {
    const sql = readRepoFile(
      'packages/core/drizzle/pg/0003_create_agent_session_and_worker_registry_state.sql',
    );

    expect(sql).toContain('CREATE TABLE IF NOT EXISTS "agent_sessions"');
    expect(sql).toContain('"owner_worker_id" text');
    expect(sql).toContain('"owner_worker_label" text');
    expect(sql).toContain('"worker_claimed_at" timestamptz');
    expect(sql).toContain('"owner_stale_since" timestamptz');
    expect(sql).toContain('"coding_agent_session_id" text');
    expect(sql).toContain('CREATE INDEX IF NOT EXISTS "agent_sessions_thread_idx"');
    expect(sql).toContain('CREATE INDEX IF NOT EXISTS "agent_sessions_status_idx"');
    expect(sql).toContain('CREATE INDEX IF NOT EXISTS "agent_sessions_owner_worker_idx"');
    expect(sql).toContain('CREATE INDEX IF NOT EXISTS "agent_sessions_owner_worker_status_idx"');

    expect(sql).toContain('CREATE TABLE IF NOT EXISTS "worker_agent_capabilities"');
    expect(sql).toContain('"enabled" boolean NOT NULL');
    expect(sql).toContain('"capability_json" jsonb NOT NULL');
    expect(sql).toContain('"started_at" timestamptz NOT NULL');
    expect(sql).toContain('"last_seen_at" timestamptz NOT NULL');
    expect(sql).toContain('"active_runtime_count" integer');
    expect(sql).toContain('"max_active_sessions" integer');
    expect(sql).toContain('CREATE INDEX IF NOT EXISTS "worker_agent_capabilities_last_seen_idx"');
    expect(sql).toContain(
      'CREATE INDEX IF NOT EXISTS "worker_agent_capabilities_enabled_last_seen_idx"',
    );
  });
});
