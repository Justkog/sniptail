import type { ChannelProvider } from '../types/channel.js';

export type AgentDefaultRecord = {
  scopeKey: string;
  provider: ChannelProvider;
  userId: string;
  guildId?: string;
  workspaceId?: string;
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
    workspaceId?: string;
  }): Promise<AgentDefaultRecord | undefined>;
  upsertDefault(input: UpsertAgentDefaultInput): Promise<AgentDefaultRecord>;
}
