import type { ChannelProvider } from '../types/channel.js';

export type AgentDefaultRecord = {
  scopeKey: string;
  provider: Extract<ChannelProvider, 'discord'>;
  userId: string;
  guildId?: string;
  workspaceKey: string;
  agentProfileKey: string;
  cwd?: string;
  createdAt: string;
  updatedAt: string;
};

export type UpsertAgentDefaultInput = Omit<
  AgentDefaultRecord,
  'scopeKey' | 'createdAt' | 'updatedAt'
> & {
  now?: Date;
};

export interface AgentDefaultStore {
  kind: 'sqlite';
  loadByActor(input: {
    provider: AgentDefaultRecord['provider'];
    userId: string;
    guildId?: string;
  }): Promise<AgentDefaultRecord | undefined>;
  upsertDefault(input: UpsertAgentDefaultInput): Promise<AgentDefaultRecord>;
}
