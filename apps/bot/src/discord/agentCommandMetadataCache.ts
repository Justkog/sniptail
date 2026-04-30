import type { BotEventPayloadMap } from '@sniptail/core/types/bot-event.js';

type DiscordAgentMetadata = BotEventPayloadMap['agent.metadata.update'];

let cachedMetadata: DiscordAgentMetadata | undefined;

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

function formatChoiceName(key: string, label: string | undefined): string {
  return label ? `${label} (${key})` : key;
}

export function setDiscordAgentCommandMetadata(metadata: DiscordAgentMetadata): void {
  cachedMetadata = metadata;
}

export function clearDiscordAgentCommandMetadata(): void {
  cachedMetadata = undefined;
}

export function getDiscordAgentCommandMetadata(): DiscordAgentMetadata | undefined {
  return cachedMetadata;
}

export function buildWorkspaceAutocompleteChoices(rawQuery: string, limit = 25): Choice[] {
  const metadata = cachedMetadata;
  if (!metadata || !metadata.enabled) {
    return [];
  }
  const query = rawQuery.trim().toLowerCase();
  return metadata.workspaces
    .map((workspace) => ({
      workspace,
      rank: rankMatch(workspace.key, workspace.label, query),
    }))
    .filter((item) => item.rank < 9)
    .sort((a, b) => {
      if (a.rank !== b.rank) return a.rank - b.rank;
      return a.workspace.key.localeCompare(b.workspace.key);
    })
    .slice(0, limit)
    .map(({ workspace }) => ({
      name: formatChoiceName(workspace.key, workspace.label),
      value: workspace.key,
    }));
}

export function buildProfileAutocompleteChoices(rawQuery: string, limit = 25): Choice[] {
  const metadata = cachedMetadata;
  if (!metadata || !metadata.enabled) {
    return [];
  }
  const query = rawQuery.trim().toLowerCase();
  return metadata.profiles
    .map((profile) => ({
      profile,
      rank: rankMatch(profile.key, profile.label, query),
    }))
    .filter((item) => item.rank < 9)
    .sort((a, b) => {
      if (a.rank !== b.rank) return a.rank - b.rank;
      return a.profile.key.localeCompare(b.profile.key);
    })
    .slice(0, limit)
    .map(({ profile }) => ({
      name: formatChoiceName(profile.key, profile.label),
      value: profile.key,
    }));
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
