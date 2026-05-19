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

function toOwnershipFields(
  ownership: Pick<
    AgentSessionRecord,
    'ownerWorkerId' | 'ownerWorkerLabel' | 'workerClaimedAt' | 'ownerStaleSince'
  >,
): Pick<
  AgentSessionRecord,
  'ownerWorkerId' | 'ownerWorkerLabel' | 'workerClaimedAt' | 'ownerStaleSince'
> {
  return {
    ...(ownership.ownerWorkerId ? { ownerWorkerId: ownership.ownerWorkerId } : {}),
    ...(ownership.ownerWorkerLabel ? { ownerWorkerLabel: ownership.ownerWorkerLabel } : {}),
    ...(ownership.workerClaimedAt ? { workerClaimedAt: ownership.workerClaimedAt } : {}),
    ...(ownership.ownerStaleSince ? { ownerStaleSince: ownership.ownerStaleSince } : {}),
  };
}

function withoutOwnershipFields(
  session: AgentSessionRecord,
): Omit<
  AgentSessionRecord,
  'ownerWorkerId' | 'ownerWorkerLabel' | 'workerClaimedAt' | 'ownerStaleSince'
> {
  const { ownerWorkerId, ownerWorkerLabel, workerClaimedAt, ownerStaleSince, ...rest } = session;
  void ownerWorkerId;
  void ownerWorkerLabel;
  void workerClaimedAt;
  void ownerStaleSince;
  return rest;
}

function fromRow(row: AgentSessionRow | undefined): AgentSessionRecord | undefined {
  if (!row) return undefined;
  return {
    sessionId: row.sessionId,
    provider: row.provider,
    channelId: row.channelId,
    threadId: row.threadId,
    userId: row.userId,
    ...(row.guildId ? { guildId: row.guildId } : {}),
    ...(row.workspaceId ? { workspaceId: row.workspaceId } : {}),
    workspaceKey: row.workspaceKey,
    agentProfileKey: row.agentProfileKey,
    ...(row.codingAgentSessionId ? { codingAgentSessionId: row.codingAgentSessionId } : {}),
    ...(row.cwd ? { cwd: row.cwd } : {}),
    ...(row.ownerWorkerId ? { ownerWorkerId: row.ownerWorkerId } : {}),
    ...(row.ownerWorkerLabel ? { ownerWorkerLabel: row.ownerWorkerLabel } : {}),
    ...(row.workerClaimedAt ? { workerClaimedAt: row.workerClaimedAt } : {}),
    ...(row.ownerStaleSince ? { ownerStaleSince: row.ownerStaleSince } : {}),
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
        ...(input.workspaceId ? { workspaceId: input.workspaceId } : {}),
        workspaceKey: input.workspaceKey,
        agentProfileKey: input.agentProfileKey,
        ...(input.codingAgentSessionId ? { codingAgentSessionId: input.codingAgentSessionId } : {}),
        ...(input.cwd ? { cwd: input.cwd } : {}),
        ...(input.ownerWorkerId ? { ownerWorkerId: input.ownerWorkerId } : {}),
        ...(input.ownerWorkerLabel ? { ownerWorkerLabel: input.ownerWorkerLabel } : {}),
        ...(input.workerClaimedAt ? { workerClaimedAt: input.workerClaimedAt } : {}),
        ...(input.ownerStaleSince ? { ownerStaleSince: input.ownerStaleSince } : {}),
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
            workspaceId: record.workspaceId,
            workspaceKey: record.workspaceKey,
            agentProfileKey: record.agentProfileKey,
            codingAgentSessionId: record.codingAgentSessionId,
            cwd: record.cwd,
            ownerWorkerId: record.ownerWorkerId,
            ownerWorkerLabel: record.ownerWorkerLabel,
            workerClaimedAt: record.workerClaimedAt,
            ownerStaleSince: record.ownerStaleSince,
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
    async updateSessionOwnership(
      sessionId: string,
      ownership: Pick<
        AgentSessionRecord,
        'ownerWorkerId' | 'ownerWorkerLabel' | 'workerClaimedAt' | 'ownerStaleSince'
      >,
    ): Promise<AgentSessionRecord | undefined> {
      const existing = await this.loadSession(sessionId);
      if (!existing) return undefined;
      const updatedAt = new Date().toISOString();
      await client.db
        .update(agentSessions)
        .set({
          ownerWorkerId: ownership.ownerWorkerId ?? null,
          ownerWorkerLabel: ownership.ownerWorkerLabel ?? null,
          workerClaimedAt: ownership.workerClaimedAt ?? null,
          ownerStaleSince: ownership.ownerStaleSince ?? null,
          updatedAt,
        })
        .where(eq(agentSessions.sessionId, sessionId));
      return {
        ...withoutOwnershipFields(existing),
        ...toOwnershipFields(ownership),
        updatedAt,
      };
    },
  };
}
