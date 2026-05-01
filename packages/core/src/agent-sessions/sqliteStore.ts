import { eq, and, desc } from 'drizzle-orm';
import type { SqliteJobRegistryClient } from '../db/index.js';
import { agentSessions } from '../db/sqlite/schema.js';
import type {
  AgentSessionRecord,
  AgentSessionStatus,
  AgentSessionStore,
  CreateAgentSessionInput,
} from './types.js';

type AgentSessionRow = typeof agentSessions.$inferSelect;

function fromRow(row: AgentSessionRow | undefined): AgentSessionRecord | undefined {
  if (!row) return undefined;
  return {
    sessionId: row.sessionId,
    provider: 'discord',
    channelId: row.channelId,
    threadId: row.threadId,
    userId: row.userId,
    ...(row.guildId ? { guildId: row.guildId } : {}),
    workspaceKey: row.workspaceKey,
    agentProfileKey: row.agentProfileKey,
    ...(row.codingAgentSessionId ? { codingAgentSessionId: row.codingAgentSessionId } : {}),
    ...(row.cwd ? { cwd: row.cwd } : {}),
    status: row.status as AgentSessionStatus,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function createSqliteAgentSessionStore(client: SqliteJobRegistryClient): AgentSessionStore {
  return {
    kind: 'sqlite',
    async createSession(input: CreateAgentSessionInput): Promise<AgentSessionRecord> {
      const now = input.now ?? new Date();
      const record: AgentSessionRecord = {
        sessionId: input.sessionId,
        provider: input.provider,
        channelId: input.channelId,
        threadId: input.threadId,
        userId: input.userId,
        ...(input.guildId ? { guildId: input.guildId } : {}),
        workspaceKey: input.workspaceKey,
        agentProfileKey: input.agentProfileKey,
        ...(input.codingAgentSessionId ? { codingAgentSessionId: input.codingAgentSessionId } : {}),
        ...(input.cwd ? { cwd: input.cwd } : {}),
        status: input.status ?? 'pending',
        createdAt: now.toISOString(),
        updatedAt: now.toISOString(),
      };
      await client.db
        .insert(agentSessions)
        .values(record)
        .onConflictDoUpdate({
          target: agentSessions.sessionId,
          set: {
            provider: record.provider,
            channelId: record.channelId,
            threadId: record.threadId,
            userId: record.userId,
            guildId: record.guildId,
            workspaceKey: record.workspaceKey,
            agentProfileKey: record.agentProfileKey,
            codingAgentSessionId: record.codingAgentSessionId,
            cwd: record.cwd,
            status: record.status,
            updatedAt: record.updatedAt,
          },
        });
      return record;
    },
    async loadSession(sessionId: string): Promise<AgentSessionRecord | undefined> {
      const rows = await client.db
        .select()
        .from(agentSessions)
        .where(eq(agentSessions.sessionId, sessionId))
        .limit(1);
      return fromRow(rows[0]);
    },
    async findSessionByThread(input: {
      provider: AgentSessionRecord['provider'];
      threadId: string;
    }): Promise<AgentSessionRecord | undefined> {
      const rows = await client.db
        .select()
        .from(agentSessions)
        .where(
          and(
            eq(agentSessions.provider, input.provider),
            eq(agentSessions.threadId, input.threadId),
          ),
        )
        .orderBy(desc(agentSessions.updatedAt))
        .limit(1);
      return fromRow(rows[0]);
    },
    async updateSessionStatus(
      sessionId: string,
      status: AgentSessionStatus,
    ): Promise<AgentSessionRecord | undefined> {
      const existing = await this.loadSession(sessionId);
      if (!existing) return undefined;
      const updatedAt = new Date().toISOString();
      await client.db
        .update(agentSessions)
        .set({ status, updatedAt })
        .where(eq(agentSessions.sessionId, sessionId));
      return {
        ...existing,
        status,
        updatedAt,
      };
    },
    async updateCodingAgentSessionId(
      sessionId: string,
      codingAgentSessionId: string,
    ): Promise<AgentSessionRecord | undefined> {
      const existing = await this.loadSession(sessionId);
      if (!existing) return undefined;
      const updatedAt = new Date().toISOString();
      await client.db
        .update(agentSessions)
        .set({ codingAgentSessionId, updatedAt })
        .where(eq(agentSessions.sessionId, sessionId));
      return {
        ...existing,
        codingAgentSessionId,
        updatedAt,
      };
    },
  };
}
