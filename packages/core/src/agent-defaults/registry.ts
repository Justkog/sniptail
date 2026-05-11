import { getAgentDefaultStore } from './store.js';
import type { AgentDefaultRecord, UpsertAgentDefaultInput } from './types.js';

export type { AgentDefaultRecord, UpsertAgentDefaultInput };

export async function loadAgentDefaults(input: {
  provider: AgentDefaultRecord['provider'];
  userId: string;
  guildId?: string;
  workspaceId?: string;
}): Promise<AgentDefaultRecord | undefined> {
  const store = await getAgentDefaultStore();
  return store.loadByActor(input);
}

export async function loadDiscordAgentDefaults(input: {
  userId: string;
  guildId?: string;
}): Promise<AgentDefaultRecord | undefined> {
  return loadAgentDefaults({
    provider: 'discord',
    userId: input.userId,
    ...(input.guildId ? { guildId: input.guildId } : {}),
  });
}

export async function loadSlackAgentDefaults(input: {
  userId: string;
  workspaceId?: string;
}): Promise<AgentDefaultRecord | undefined> {
  return loadAgentDefaults({
    provider: 'slack',
    userId: input.userId,
    ...(input.workspaceId ? { workspaceId: input.workspaceId } : {}),
  });
}

export async function upsertAgentDefaults(
  input: UpsertAgentDefaultInput,
): Promise<AgentDefaultRecord> {
  const store = await getAgentDefaultStore();
  return store.upsertDefault(input);
}

export async function upsertDiscordAgentDefaults(
  input: Omit<UpsertAgentDefaultInput, 'provider'>,
): Promise<AgentDefaultRecord> {
  return upsertAgentDefaults({
    provider: 'discord',
    ...input,
  });
}

export async function upsertSlackAgentDefaults(
  input: Omit<UpsertAgentDefaultInput, 'provider'>,
): Promise<AgentDefaultRecord> {
  return upsertAgentDefaults({
    provider: 'slack',
    ...input,
  });
}
