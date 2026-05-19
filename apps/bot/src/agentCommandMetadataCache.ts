import {
  findEligibleAgentWorkers,
  type AggregatedAgentCapabilities,
  type AggregatedProfileCapability,
  type AggregatedWorkspaceCapability,
} from '@sniptail/core/agent-capabilities/agentCapabilities.js';
import { loadAggregatedAgentCapabilitySnapshot } from '@sniptail/core/registry/registryCapabilities.js';

const AGENT_METADATA_CACHE_TTL_MS = 5_000;

export type AgentCommandWorkspaceMetadata = Pick<
  AggregatedWorkspaceCapability,
  'key' | 'status' | 'label' | 'description' | 'workerIds'
>;

export type AgentCommandProfileMetadata = Pick<
  AggregatedProfileCapability,
  | 'key'
  | 'status'
  | 'provider'
  | 'agent'
  | 'profile'
  | 'model'
  | 'modelProvider'
  | 'reasoningEffort'
  | 'label'
  | 'description'
  | 'workerIds'
>;

export type AgentCommandMetadata = {
  enabled: boolean;
  receivedAt: string;
  workspaces: AgentCommandWorkspaceMetadata[];
  profiles: AgentCommandProfileMetadata[];
  aggregated: AggregatedAgentCapabilities;
  activeSessionCounts: Record<string, number>;
};

type CachedMetadata = {
  metadata: AgentCommandMetadata;
  expiresAtMs: number;
};

type Choice = {
  name: string;
  value: string;
};

let cachedMetadata: CachedMetadata | undefined;
let pendingMetadataLoad: Promise<AgentCommandMetadata> | undefined;

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

function toWorkspaceMetadata(
  workspace: AggregatedWorkspaceCapability,
): AgentCommandWorkspaceMetadata {
  return {
    key: workspace.key,
    status: workspace.status,
    ...(workspace.label ? { label: workspace.label } : {}),
    ...(workspace.description ? { description: workspace.description } : {}),
    workerIds: workspace.workerIds,
  };
}

function toProfileMetadata(profile: AggregatedProfileCapability): AgentCommandProfileMetadata {
  return {
    key: profile.key,
    status: profile.status,
    ...(profile.provider ? { provider: profile.provider } : {}),
    ...(profile.agent ? { agent: profile.agent } : {}),
    ...(profile.profile ? { profile: profile.profile } : {}),
    ...(profile.model ? { model: profile.model } : {}),
    ...(profile.modelProvider ? { modelProvider: profile.modelProvider } : {}),
    ...(profile.reasoningEffort ? { reasoningEffort: profile.reasoningEffort } : {}),
    ...(profile.label ? { label: profile.label } : {}),
    ...(profile.description ? { description: profile.description } : {}),
    workerIds: profile.workerIds,
  };
}

function buildMetadata(
  snapshot: Awaited<ReturnType<typeof loadAggregatedAgentCapabilitySnapshot>>,
): AgentCommandMetadata {
  return {
    enabled: snapshot.aggregated.liveWorkers.length > 0,
    receivedAt: snapshot.aggregated.generatedAt,
    workspaces: snapshot.aggregated.workspaces.map(toWorkspaceMetadata),
    profiles: snapshot.aggregated.profiles.map(toProfileMetadata),
    aggregated: snapshot.aggregated,
    activeSessionCounts: snapshot.activeSessionCounts,
  };
}

export function clearAgentCommandMetadata(): void {
  cachedMetadata = undefined;
  pendingMetadataLoad = undefined;
}

export async function loadAgentCommandMetadata(
  options: { forceRefresh?: boolean } = {},
): Promise<AgentCommandMetadata> {
  const nowMs = Date.now();
  if (!options.forceRefresh && cachedMetadata && cachedMetadata.expiresAtMs > nowMs) {
    return cachedMetadata.metadata;
  }
  if (!options.forceRefresh && pendingMetadataLoad) {
    return pendingMetadataLoad;
  }

  pendingMetadataLoad = (async () => {
    const metadata = buildMetadata(await loadAggregatedAgentCapabilitySnapshot());
    cachedMetadata = {
      metadata,
      expiresAtMs: Date.now() + AGENT_METADATA_CACHE_TTL_MS,
    };
    return metadata;
  })();

  try {
    return await pendingMetadataLoad;
  } finally {
    pendingMetadataLoad = undefined;
  }
}

export function findAgentWorkspaceMetadata(
  metadata: AgentCommandMetadata,
  key: string,
): AgentCommandWorkspaceMetadata | undefined {
  return metadata.workspaces.find((workspace) => workspace.key === key);
}

export function findAgentProfileMetadata(
  metadata: AgentCommandMetadata,
  key: string,
): AgentCommandProfileMetadata | undefined {
  return metadata.profiles.find((profile) => profile.key === key);
}

export function listSelectableAgentProfiles(
  metadata: AgentCommandMetadata,
): AgentCommandProfileMetadata[] {
  return metadata.profiles.filter((profile) => profile.status === 'available');
}

export function hasEligibleWorkerForSelection(
  metadata: AgentCommandMetadata,
  workspaceKey: string,
  profileKey: string,
): boolean {
  return (
    findEligibleAgentWorkers({
      aggregated: metadata.aggregated,
      workspaceKey,
      profileKey,
      activeSessionCounts: metadata.activeSessionCounts,
    }).length > 0
  );
}

export async function buildWorkspaceAutocompleteChoices(
  rawQuery: string,
  preferredWorkspaceKey?: string,
  limit = 25,
): Promise<Choice[]> {
  const metadata = await loadAgentCommandMetadata();
  if (!metadata.enabled) {
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

export async function buildProfileAutocompleteChoices(
  rawQuery: string,
  preferredProfileKey?: string,
  limit = 25,
): Promise<Choice[]> {
  const metadata = await loadAgentCommandMetadata();
  if (!metadata.enabled) {
    return [];
  }
  const query = rawQuery.trim().toLowerCase();
  return sortRankedChoices(
    listSelectableAgentProfiles(metadata).map((profile) => ({
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
