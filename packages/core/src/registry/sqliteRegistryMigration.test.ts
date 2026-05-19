import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createSqliteClient } from '../db/sqlite/client.js';
import { migrateDb } from '../db/migrations.js';

describe('sqlite registry migration', () => {
  const tempDirs = new Set<string>();

  afterEach(() => {
    for (const dir of tempDirs) {
      rmSync(dir, { recursive: true, force: true });
    }
    tempDirs.clear();
  });

  it('creates worker registry tables and owner columns', async () => {
    const registryDir = mkdtempSync(join(tmpdir(), 'sniptail-registry-migration-'));
    tempDirs.add(registryDir);

    const status = await migrateDb(
      {
        registryDriver: 'sqlite',
        registryPath: registryDir,
      },
      { rootDir: process.cwd() },
    );

    expect(status.isUpToDate).toBe(true);
    expect(status.expectedMigrations).toBe(9);

    const client = await createSqliteClient(registryDir);
    try {
      const workerTable = client.raw
        .prepare(
          "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'worker_agent_capabilities'",
        )
        .get() as { name: string } | undefined;
      expect(workerTable?.name).toBe('worker_agent_capabilities');

      const ownerColumns = client.raw
        .prepare("PRAGMA table_info('agent_sessions')")
        .all() as Array<{ name: string }>;
      expect(ownerColumns.map((column) => column.name)).toEqual(
        expect.arrayContaining([
          'owner_worker_id',
          'owner_worker_label',
          'worker_claimed_at',
          'owner_stale_since',
        ]),
      );

      const indexes = client.raw
        .prepare(
          "SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'agent_sessions'",
        )
        .all() as Array<{ name: string }>;
      expect(indexes.map((index) => index.name)).toEqual(
        expect.arrayContaining([
          'agent_sessions_owner_worker_idx',
          'agent_sessions_owner_worker_status_idx',
        ]),
      );
    } finally {
      client.raw.close();
    }
  });
});
