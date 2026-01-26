import { mkdirSync, statSync } from 'node:fs';
import { dirname, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config as loadEnv } from 'dotenv';
import { defineConfig } from 'drizzle-kit';

const JOB_REGISTRY_FILENAME = 'job-registry.sqlite';

const envPath =
  process.env.DOTENV_CONFIG_PATH ?? fileURLToPath(new URL('../../.env', import.meta.url));
loadEnv({ path: envPath });

function resolveSqliteDbPath(configured: string): string {
  if (configured.endsWith('/')) {
    return join(configured, JOB_REGISTRY_FILENAME);
  }
  try {
    const stats = statSync(configured);
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

const registryPath = process.env.JOB_REGISTRY_PATH ?? './data/job-registry';
const resolvedPath = resolveSqliteDbPath(registryPath);
mkdirSync(dirname(resolvedPath), { recursive: true });

export default defineConfig({
  schema: './src/db/sqlite/schema.ts',
  out: './drizzle/sqlite',
  dialect: 'sqlite',
  dbCredentials: {
    url: resolvedPath,
  },
});
