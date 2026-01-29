import type { BotConfig } from '@sniptail/core/config/config.js';
import { parseRepoAllowlist } from '@sniptail/core/config/config.js';
import { logger } from '@sniptail/core/logger.js';

export function refreshRepoAllowlist(config: BotConfig) {
  const allowlistPath = config.repoAllowlistPath;
  if (!allowlistPath) {
    return;
  }
  try {
    config.repoAllowlist = parseRepoAllowlist(allowlistPath);
  } catch (err) {
    logger.warn({ err, allowlistPath }, 'Failed to refresh repo allowlist');
  }
}
