import type { BotConfig } from '@sniptail/core/config/config.js';
import { listBootstrapProviderIds } from '@sniptail/core/repos/providers.js';
import type { RepoBootstrapService } from '@sniptail/core/types/bootstrap.js';

export function resolveBootstrapServices(config: BotConfig): RepoBootstrapService[] {
  return listBootstrapProviderIds(config.bootstrapServices);
}
