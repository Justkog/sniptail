import type { BotConfig } from '@sniptail/core/config/index.js';
import { parseRepoAllowlist } from '@sniptail/core/config/index.js';
import { logger } from '@sniptail/core/logger.js';

export function refreshRepoAllowlist(config: BotConfig) {
  const allowlistPath = process.env.REPO_ALLOWLIST_PATH?.trim();
  if (!allowlistPath) {
    return;
  }
  try {
    config.repoAllowlist = parseRepoAllowlist(allowlistPath);
  } catch (err) {
    logger.warn({ err, allowlistPath }, 'Failed to refresh repo allowlist');
  }
}
