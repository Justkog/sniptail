import type { BotConfig } from '@sniptail/core/config/config.js';
import type { RepoBootstrapService } from '@sniptail/core/types/bootstrap.js';

export function resolveBootstrapServices(config: BotConfig): RepoBootstrapService[] {
  const services: RepoBootstrapService[] = [];
  services.push('local');
  if (config.github) services.push('github');
  if (config.gitlab) services.push('gitlab');
  return services;
}
