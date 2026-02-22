import type { BotConfig } from '@sniptail/core/config/config.js';
import { intersectRunActionIds, listRunActionIds } from '@sniptail/core/repos/runActions.js';

export type AvailableRunAction = {
  id: string;
  label: string;
  description?: string;
};

export function listConfiguredRunActions(config: BotConfig): AvailableRunAction[] {
  const entries = Object.entries(config.run?.actions ?? {});
  return entries
    .map(([id, value]) => ({
      id,
      label: value.label,
      ...(value.description ? { description: value.description } : {}),
    }))
    .sort((a, b) => a.id.localeCompare(b.id));
}

export function computeAvailableRunActions(
  config: BotConfig,
  repoKeys: string[],
): AvailableRunAction[] {
  if (!repoKeys.length) {
    return [];
  }
  const configured = listConfiguredRunActions(config);
  if (!configured.length) {
    return [];
  }

  const repoActionSets = repoKeys.map((repoKey) => {
    const repoConfig = config.repoAllowlist[repoKey];
    return listRunActionIds(repoConfig?.providerData);
  });
  const commonIds = intersectRunActionIds(
    repoActionSets,
    configured.map((action) => action.id),
  );

  const byId = new Map(configured.map((action) => [action.id, action]));
  return commonIds.map((actionId) => byId.get(actionId)).filter(Boolean) as AvailableRunAction[];
}
