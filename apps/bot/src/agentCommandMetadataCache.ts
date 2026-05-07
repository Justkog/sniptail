import type { BotEventPayloadMap } from '@sniptail/core/types/bot-event.js';

type AgentMetadata = BotEventPayloadMap['agent.metadata.update'];

let cachedMetadata: AgentMetadata | undefined;

function normalizeOptionalToken(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

function rankMatch(itemKey: string, itemLabel: string | undefined, query: string): number {
  if (!query) return 3;
  const keyLower = itemKey.toLowerCase();
  const labelLower = itemLabel?.toLowerCase();
  if (keyLower.startsWith(query) || labelLower?.startsWith(query)) return 0;
  if (keyLower.includes(query) || labelLower?.includes(query)) return 1;
  return 9;
}

type Choice = {
  name: string;
  value: string;
};

function sortRankedChoices<T extends { key: string }>(
  items: Array<{ item: T; rank: number; preferred: boolean }>,
): Array<{ item: T; rank: number; preferred: boolean }> {
  return items.sort((a, b) => {
    if (a.preferred !== b.preferred) return a.preferred ? -1 : 1;
    if (a.rank !== b.rank) return a.rank - b.rank;
    return a.item.key.localeCompare(b.item.key);
  });
}

function formatChoiceName(key: string, label: string | undefined): string {
  return label ? `${label} (${key})` : key;
}

export function setAgentCommandMetadata(metadata: AgentMetadata): void {
  cachedMetadata = metadata;
}

export function clearAgentCommandMetadata(): void {
  cachedMetadata = undefined;
}

export function getAgentCommandMetadata(): AgentMetadata | undefined {
  return cachedMetadata;
}

export function buildWorkspaceAutocompleteChoices(
  rawQuery: string,
  preferredWorkspaceKey?: string,
  limit = 25,
): Choice[] {
  const metadata = cachedMetadata;
  if (!metadata || !metadata.enabled) {
    return [];
  }
  const query = rawQuery.trim().toLowerCase();
  return sortRankedChoices(
    metadata.workspaces.map((workspace) => ({
      item: workspace,
      rank: rankMatch(workspace.key, workspace.label, query),
      preferred: workspace.key === preferredWorkspaceKey,
    })),
  )
    .filter((item) => item.rank < 9)
    .slice(0, limit)
    .map(({ item }) => ({
      name: formatChoiceName(item.key, item.label),
      value: item.key,
    }));
}

export function buildProfileAutocompleteChoices(
  rawQuery: string,
  preferredProfileKey?: string,
  limit = 25,
): Choice[] {
  const metadata = cachedMetadata;
  if (!metadata || !metadata.enabled) {
    return [];
  }
  const query = rawQuery.trim().toLowerCase();
  return sortRankedChoices(
    metadata.profiles.map((profile) => ({
      item: profile,
      rank: rankMatch(profile.key, profile.label, query),
      preferred: profile.key === preferredProfileKey,
    })),
  )
    .filter((item) => item.rank < 9)
    .slice(0, limit)
    .map(({ item }) => ({
      name: formatChoiceName(item.key, item.label),
      value: item.key,
    }));
}

export function buildCwdAutocompleteChoices(
  rawQuery: string,
  preferredCwd?: string,
  limit = 25,
): Choice[] {
  const cwd = normalizeOptionalToken(preferredCwd);
  if (!cwd) {
    return [];
  }
  const query = rawQuery.trim().toLowerCase();
  if (query && !cwd.toLowerCase().includes(query)) {
    return [];
  }
  return [{ name: cwd, value: cwd }].slice(0, limit);
}

export function resolveAgentWorkspaceSelection(explicitWorkspaceKey?: string): string | undefined {
  const metadata = cachedMetadata;
  if (!metadata || !metadata.enabled) {
    return undefined;
  }
  const workspaceKey = normalizeOptionalToken(explicitWorkspaceKey) ?? metadata.defaultWorkspace;
  if (!workspaceKey) {
    return undefined;
  }
  return metadata.workspaces.some((workspace) => workspace.key === workspaceKey)
    ? workspaceKey
    : undefined;
}

export function resolveAgentProfileSelection(explicitProfileKey?: string): string | undefined {
  const metadata = cachedMetadata;
  if (!metadata || !metadata.enabled) {
    return undefined;
  }
  const profileKey = normalizeOptionalToken(explicitProfileKey) ?? metadata.defaultAgentProfile;
  if (!profileKey) {
    return undefined;
  }
  return metadata.profiles.some((profile) => profile.key === profileKey) ? profileKey : undefined;
}
