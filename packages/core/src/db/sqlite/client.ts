import { mkdir, stat } from 'node:fs/promises';
import { dirname, extname, join } from 'node:path';
import Database from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import * as schema from './schema.js';

const SQLITE_BUSY_TIMEOUT_MS = 5000;
const JOB_REGISTRY_FILENAME = 'job-registry.sqlite';

export interface ISqliteClient {
  kind: 'sqlite';
  db: BetterSQLite3Database<typeof schema>;
  raw: Database.Database;
  path: string;
}

async function resolveSqliteDbPath(configured: string): Promise<string> {
  if (configured.endsWith('/')) {
    return join(configured, JOB_REGISTRY_FILENAME);
  }
  try {
    const stats = await stat(configured);
    if (stats.isDirectory()) {
      return join(configured, JOB_REGISTRY_FILENAME);
    }
    return configured;
  } catch {
    const ext = extname(configured).toLowerCase();
    if (ext === '.db' || ext === '.sqlite' || ext === '.sqlite3') {
      return configured;
    }
    return join(configured, JOB_REGISTRY_FILENAME);
  }
}

export async function createSqliteClient(configuredPath: string): Promise<ISqliteClient> {
  const dbFilePath = await resolveSqliteDbPath(configuredPath);
  await mkdir(dirname(dbFilePath), { recursive: true });

  const sqlite = new Database(dbFilePath);
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma(`busy_timeout = ${SQLITE_BUSY_TIMEOUT_MS}`);

  const db = drizzle({ client: sqlite, schema });

  return {
    kind: 'sqlite',
    db,
    raw: sqlite,
    path: dbFilePath,
  };
}
