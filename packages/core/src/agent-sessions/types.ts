import type { ChannelProvider } from '../types/channel.js';

export type AgentSessionStatus = 'pending' | 'active' | 'stopped' | 'completed' | 'failed';

export type AgentSessionRecord = {
  sessionId: string;
  provider: ChannelProvider;
  channelId: string;
  threadId: string;
  userId: string;
  guildId?: string;
  workspaceId?: string;
  workspaceKey: string;
  agentProfileKey: string;
  codingAgentSessionId?: string;
  cwd?: string;
  status: AgentSessionStatus;
  createdAt: string;
  updatedAt: string;
};

export type CreateAgentSessionInput = Omit<
  AgentSessionRecord,
  'status' | 'createdAt' | 'updatedAt'
> & {
  status?: AgentSessionStatus;
  now?: Date;
};

export interface AgentSessionStore {
  kind: 'sqlite';
  createSession(input: CreateAgentSessionInput): Promise<AgentSessionRecord>;
  loadSession(sessionId: string): Promise<AgentSessionRecord | undefined>;
  findSessionByThread(input: {
    provider: AgentSessionRecord['provider'];
    threadId: string;
  }): Promise<AgentSessionRecord | undefined>;
  updateSessionStatus(
    sessionId: string,
    status: AgentSessionStatus,
  ): Promise<AgentSessionRecord | undefined>;
  updateCodingAgentSessionId(
    sessionId: string,
    codingAgentSessionId: string,
  ): Promise<AgentSessionRecord | undefined>;
}
