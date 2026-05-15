import { mkdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config as loadEnv } from 'dotenv';
import { defineConfig } from 'drizzle-kit';
import { parse as parseToml } from 'smol-toml';

const REGISTRY_SQLITE_FILENAME = 'job-registry.sqlite';

const envPath =
  process.env.DOTENV_CONFIG_PATH ?? fileURLToPath(new URL('../../.env', import.meta.url));
loadEnv({ path: envPath });

function resolveSqliteDbPath(configured: string): string {
  if (configured.endsWith('/')) {
    return join(configured, REGISTRY_SQLITE_FILENAME);
  }
  try {
    const stats = statSync(configured);
    if (stats.isDirectory()) {
      return join(configured, REGISTRY_SQLITE_FILENAME);
    }
    return configured;
  } catch {
    const ext = extname(configured).toLowerCase();
    if (ext === '.db' || ext === '.sqlite' || ext === '.sqlite3') {
      return configured;
    }
    return join(configured, REGISTRY_SQLITE_FILENAME);
  }
}

function resolveRegistryPath(): string {
  const envPath = process.env.SNIPTAIL_REGISTRY_PATH?.trim();
  if (envPath) return envPath;

  const configPath = resolve(
    process.cwd(),
    process.env.SNIPTAIL_WORKER_CONFIG_PATH ?? '../../sniptail.worker.toml',
  );
  try {
    const raw = readFileSync(configPath, 'utf8');
    const parsed = parseToml(raw) as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const registry = (parsed as { registry?: unknown }).registry;
      if (registry && typeof registry === 'object' && !Array.isArray(registry)) {
        const tomlPath = (registry as { path?: unknown }).path;
        if (typeof tomlPath === 'string' && tomlPath.trim() !== '') {
          return tomlPath.trim();
        }
      }
    }
  } catch {
    // Fall back to default below.
  }
  return './data/job-registry';
}

const registryPath = resolveRegistryPath();
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
