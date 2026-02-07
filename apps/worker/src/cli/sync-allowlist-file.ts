import 'dotenv/config';
import { loadWorkerConfig } from '@sniptail/core/config/config.js';
import { logger } from '@sniptail/core/logger.js';
import { syncAllowlistFileFromCatalog } from '@sniptail/core/repos/catalog.js';

async function main() {
  const config = loadWorkerConfig();
  const allowlistPath = config.repoAllowlistPath;
  if (!allowlistPath) {
    throw new Error('repo_allowlist_path (or REPO_ALLOWLIST_PATH) is not configured.');
  }

  const count = await syncAllowlistFileFromCatalog(allowlistPath);
  logger.info(
    { allowlistPath, count },
    'Synchronized allowlist file from DB-backed repository catalog',
  );
}

void main().catch((err) => {
  logger.error({ err }, 'Failed to sync allowlist file from repository catalog');
  process.exitCode = 1;
});
