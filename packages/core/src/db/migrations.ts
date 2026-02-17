import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { migrate as migratePg } from 'drizzle-orm/node-postgres/migrator';
import { migrate as migrateSqlite } from 'drizzle-orm/better-sqlite3/migrator';
import type { CoreConfig } from '../config/types.js';
import { createPgClient } from './pg/client.js';
import { createSqliteClient } from './sqlite/client.js';

type DbMigrationConfig = Pick<CoreConfig, 'jobRegistryDriver' | 'jobRegistryPath' | 'jobRegistryPgUrl'>;

type MigrationJournal = {
  entries: Array<{
    idx: number;
    tag: string;
  }>;
};

export type DbMigrationStatus = {
  driver: CoreConfig['jobRegistryDriver'];
  expectedMigrations: number;
  appliedMigrations: number;
  pendingMigrations: number;
  isUpToDate: boolean;
  isAhead: boolean;
  latestExpectedTag?: string;
  latestAppliedAt?: number;
};

function resolveRootDir(explicitRootDir?: string): string {
  if (explicitRootDir) {
    return resolve(explicitRootDir);
  }
  const rootFromEnv = process.env.SNIPTAIL_ROOT?.trim();
  if (rootFromEnv) {
    return resolve(rootFromEnv);
  }
  return resolve(process.cwd(), '../..');
}

function resolveMigrationsFolder(
  driver: Extract<CoreConfig['jobRegistryDriver'], 'pg' | 'sqlite'>,
  rootDir: string,
): string {
  return join(rootDir, 'packages', 'core', 'drizzle', driver);
}

async function readJournal(
  driver: Extract<CoreConfig['jobRegistryDriver'], 'pg' | 'sqlite'>,
  rootDir: string,
): Promise<MigrationJournal> {
  const migrationsFolder = resolveMigrationsFolder(driver, rootDir);
  const journalPath = join(migrationsFolder, 'meta', '_journal.json');
  if (!existsSync(journalPath)) {
    throw new Error(`Missing migration journal at ${journalPath}.`);
  }
  const raw = await readFile(journalPath, 'utf8');
  const parsed = JSON.parse(raw) as unknown;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`Invalid migration journal JSON at ${journalPath}.`);
  }
  const entries = (parsed as { entries?: unknown }).entries;
  if (!Array.isArray(entries)) {
    throw new Error(`Invalid migration journal entries at ${journalPath}.`);
  }
  return {
    entries: entries
      .map((entry) => {
        if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return undefined;
        const idx = (entry as { idx?: unknown }).idx;
        const tag = (entry as { tag?: unknown }).tag;
        if (typeof idx !== 'number' || !Number.isFinite(idx) || typeof tag !== 'string') {
          return undefined;
        }
        return { idx, tag };
      })
      .filter((entry): entry is { idx: number; tag: string } => Boolean(entry)),
  };
}

async function getPgAppliedMigrations(
  config: DbMigrationConfig,
): Promise<{ appliedMigrations: number; latestAppliedAt?: number }> {
  if (!config.jobRegistryPgUrl) {
    throw new Error('JOB_REGISTRY_PG_URL is required when JOB_REGISTRY_DB=pg');
  }

  const client = await createPgClient(config.jobRegistryPgUrl);
  try {
    const existsResult = await client.pool.query<{
      drizzle_table: string | null;
      public_table: string | null;
    }>(
      `SELECT
         to_regclass('drizzle.__drizzle_migrations')::text AS drizzle_table,
         to_regclass('public.__drizzle_migrations')::text AS public_table`,
    );
    const migrationsTable =
      existsResult.rows[0]?.drizzle_table ?? existsResult.rows[0]?.public_table;
    if (!migrationsTable) {
      return { appliedMigrations: 0 };
    }

    const countResult = await client.pool.query<{
      applied_migrations: number | string;
      latest_applied_at: number | string | null;
    }>(
      `SELECT COUNT(*)::int AS applied_migrations, MAX(created_at) AS latest_applied_at FROM ${migrationsTable}`,
    );
    const row = countResult.rows[0];
    const applied = Number(row?.applied_migrations ?? 0);
    const latestRaw = row?.latest_applied_at;
    const latestAppliedAt =
      latestRaw === null || latestRaw === undefined ? undefined : Number(latestRaw);
    return {
      appliedMigrations: Number.isFinite(applied) ? applied : 0,
      ...(latestAppliedAt !== undefined && Number.isFinite(latestAppliedAt)
        ? { latestAppliedAt }
        : {}),
    };
  } finally {
    await client.pool.end();
  }
}

async function getSqliteAppliedMigrations(
  config: DbMigrationConfig,
): Promise<{ appliedMigrations: number; latestAppliedAt?: number }> {
  if (!config.jobRegistryPath) {
    throw new Error('JOB_REGISTRY_PATH is required when JOB_REGISTRY_DB=sqlite');
  }

  const client = await createSqliteClient(config.jobRegistryPath);
  try {
    const table = client.raw
      .prepare(
        `SELECT name FROM sqlite_master WHERE type = 'table' AND name = '__drizzle_migrations'`,
      )
      .get() as { name: string } | undefined;
    if (!table) {
      return { appliedMigrations: 0 };
    }

    const row = client.raw
      .prepare(
        `SELECT COUNT(*) AS applied_migrations, MAX(created_at) AS latest_applied_at FROM __drizzle_migrations`,
      )
      .get() as { applied_migrations: number; latest_applied_at: number | null };
    const applied = Number(row?.applied_migrations ?? 0);
    const latestRaw = row?.latest_applied_at;
    return {
      appliedMigrations: Number.isFinite(applied) ? applied : 0,
      ...(latestRaw !== null && latestRaw !== undefined && Number.isFinite(Number(latestRaw))
        ? { latestAppliedAt: Number(latestRaw) }
        : {}),
    };
  } finally {
    client.raw.close();
  }
}

function buildStatus(
  driver: CoreConfig['jobRegistryDriver'],
  expectedMigrations: number,
  appliedMigrations: number,
  latestExpectedTag?: string,
  latestAppliedAt?: number,
): DbMigrationStatus {
  const pendingMigrations = Math.max(expectedMigrations - appliedMigrations, 0);
  const isAhead = appliedMigrations > expectedMigrations;
  const isUpToDate = appliedMigrations === expectedMigrations;
  return {
    driver,
    expectedMigrations,
    appliedMigrations,
    pendingMigrations,
    isAhead,
    isUpToDate,
    ...(latestExpectedTag ? { latestExpectedTag } : {}),
    ...(latestAppliedAt !== undefined ? { latestAppliedAt } : {}),
  };
}

export async function getDbMigrationStatus(
  config: DbMigrationConfig,
  options: { rootDir?: string } = {},
): Promise<DbMigrationStatus> {
  if (config.jobRegistryDriver === 'redis') {
    return buildStatus('redis', 0, 0);
  }

  const rootDir = resolveRootDir(options.rootDir);
  const journal = await readJournal(config.jobRegistryDriver, rootDir);
  const expectedMigrations = journal.entries.length;
  const latestExpectedTag = journal.entries[journal.entries.length - 1]?.tag;

  if (config.jobRegistryDriver === 'pg') {
    const { appliedMigrations, latestAppliedAt } = await getPgAppliedMigrations(config);
    return buildStatus(
      'pg',
      expectedMigrations,
      appliedMigrations,
      latestExpectedTag,
      latestAppliedAt,
    );
  }

  const { appliedMigrations, latestAppliedAt } = await getSqliteAppliedMigrations(config);
  return buildStatus(
    'sqlite',
    expectedMigrations,
    appliedMigrations,
    latestExpectedTag,
    latestAppliedAt,
  );
}

export async function migrateDb(
  config: DbMigrationConfig,
  options: { rootDir?: string } = {},
): Promise<DbMigrationStatus> {
  if (config.jobRegistryDriver === 'redis') {
    return buildStatus('redis', 0, 0);
  }

  const rootDir = resolveRootDir(options.rootDir);
  const migrationsFolder = resolveMigrationsFolder(config.jobRegistryDriver, rootDir);
  if (!existsSync(migrationsFolder)) {
    throw new Error(`Missing migrations folder at ${migrationsFolder}.`);
  }

  if (config.jobRegistryDriver === 'pg') {
    if (!config.jobRegistryPgUrl) {
      throw new Error('JOB_REGISTRY_PG_URL is required when JOB_REGISTRY_DB=pg');
    }
    const client = await createPgClient(config.jobRegistryPgUrl);
    try {
      await migratePg(client.db, { migrationsFolder });
    } finally {
      await client.pool.end();
    }
    return getDbMigrationStatus(config, { rootDir });
  }

  if (!config.jobRegistryPath) {
    throw new Error('JOB_REGISTRY_PATH is required when JOB_REGISTRY_DB=sqlite');
  }
  const client = await createSqliteClient(config.jobRegistryPath);
  try {
    migrateSqlite(client.db, { migrationsFolder });
  } finally {
    client.raw.close();
  }
  return getDbMigrationStatus(config, { rootDir });
}
