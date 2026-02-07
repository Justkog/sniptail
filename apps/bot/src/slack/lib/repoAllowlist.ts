import type { BotConfig } from '@sniptail/core/config/config.js';
import { loadRepoAllowlistFromCatalog } from '@sniptail/core/repos/catalog.js';
import { logger } from '@sniptail/core/logger.js';

export async function refreshRepoAllowlist(config: BotConfig) {
  try {
    config.repoAllowlist = await loadRepoAllowlistFromCatalog();
  } catch (err) {
    logger.warn({ err }, 'Failed to refresh repo allowlist from catalog');
  }
}
