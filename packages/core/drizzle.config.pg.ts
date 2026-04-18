import { fileURLToPath } from 'node:url';
import { config as loadEnv } from 'dotenv';
import { defineConfig } from 'drizzle-kit';

const envPath =
  process.env.DOTENV_CONFIG_PATH ?? fileURLToPath(new URL('../../.env', import.meta.url));
loadEnv({ path: envPath });

const pgUrl = process.env.JOB_REGISTRY_PG_URL;
if (!pgUrl) {
  throw new Error('JOB_REGISTRY_PG_URL is required for postgres migrations.');
}

export default defineConfig({
  schema: './src/db/pg/schema.ts',
  out: './drizzle/pg',
  dialect: 'postgresql',
  dbCredentials: {
    url: pgUrl,
  },
});
