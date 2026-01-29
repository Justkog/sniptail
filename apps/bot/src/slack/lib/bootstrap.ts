import type { BotConfig } from '@sniptail/core/config/config.js';
import type { RepoBootstrapService } from '@sniptail/core/types/bootstrap.js';

export function resolveBootstrapServices(config: BotConfig): RepoBootstrapService[] {
  const services = new Set<RepoBootstrapService>(['local']);
  for (const service of config.bootstrapServices) {
    services.add(service);
  }
  return Array.from(services);
}
