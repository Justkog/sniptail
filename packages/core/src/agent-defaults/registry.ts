import { getAgentDefaultStore } from './store.js';
import type { AgentDefaultRecord, UpsertAgentDefaultInput } from './types.js';

export type { AgentDefaultRecord, UpsertAgentDefaultInput };

export async function loadDiscordAgentDefaults(input: {
  userId: string;
  guildId?: string;
}): Promise<AgentDefaultRecord | undefined> {
  const store = await getAgentDefaultStore();
  return store.loadByActor({
    provider: 'discord',
    userId: input.userId,
    ...(input.guildId ? { guildId: input.guildId } : {}),
  });
}

export async function upsertDiscordAgentDefaults(
  input: Omit<UpsertAgentDefaultInput, 'provider'>,
): Promise<AgentDefaultRecord> {
  const store = await getAgentDefaultStore();
  return store.upsertDefault({
    provider: 'discord',
    ...input,
  });
}
