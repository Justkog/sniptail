import { and, eq, isNull } from 'drizzle-orm';
import type { SqliteJobRegistryClient } from '../db/index.js';
import { agentDefaults } from '../db/sqlite/schema.js';
import type { AgentDefaultRecord, AgentDefaultStore, UpsertAgentDefaultInput } from './types.js';

type AgentDefaultRow = typeof agentDefaults.$inferSelect;

function buildScopeKey(input: {
  provider: AgentDefaultRecord['provider'];
  userId: string;
  guildId?: string;
  workspaceId?: string;
}): string {
  if (input.provider === 'slack') {
    return input.workspaceId
      ? `${input.provider}:workspace:${input.workspaceId}:user:${input.userId}`
      : `${input.provider}:dm:user:${input.userId}`;
  }
  return input.guildId
    ? `${input.provider}:guild:${input.guildId}:user:${input.userId}`
    : `${input.provider}:dm:user:${input.userId}`;
}

function fromRow(row: AgentDefaultRow | undefined): AgentDefaultRecord | undefined {
  if (!row) return undefined;
  return {
    scopeKey: row.scopeKey,
    provider: row.provider,
    userId: row.userId,
    ...(row.guildId ? { guildId: row.guildId } : {}),
    ...(row.workspaceId ? { workspaceId: row.workspaceId } : {}),
    workspaceKey: row.workspaceKey,
    agentProfileKey: row.agentProfileKey,
    ...(row.cwd ? { cwd: row.cwd } : {}),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function createSqliteAgentDefaultStore(client: SqliteJobRegistryClient): AgentDefaultStore {
  return {
    kind: 'sqlite',
    async loadByActor(input) {
      const rows = await client.db
        .select()
        .from(agentDefaults)
        .where(
          and(
            eq(agentDefaults.provider, input.provider),
            eq(agentDefaults.userId, input.userId),
            input.guildId === undefined
              ? isNull(agentDefaults.guildId)
              : eq(agentDefaults.guildId, input.guildId),
            input.workspaceId === undefined
              ? isNull(agentDefaults.workspaceId)
              : eq(agentDefaults.workspaceId, input.workspaceId),
          ),
        )
        .limit(1);
      return fromRow(rows[0]);
    },
    async upsertDefault(input: UpsertAgentDefaultInput): Promise<AgentDefaultRecord> {
      const now = input.now ?? new Date();
      const scopeKey = buildScopeKey(input);
      const record: AgentDefaultRecord = {
        scopeKey,
        provider: input.provider,
        userId: input.userId,
        ...(input.guildId ? { guildId: input.guildId } : {}),
        ...(input.workspaceId ? { workspaceId: input.workspaceId } : {}),
        workspaceKey: input.workspaceKey,
        agentProfileKey: input.agentProfileKey,
        ...(input.cwd ? { cwd: input.cwd } : {}),
        createdAt: now.toISOString(),
        updatedAt: now.toISOString(),
      };
      const existing = await this.loadByActor(input);
      await client.db
        .insert(agentDefaults)
        .values(record)
        .onConflictDoUpdate({
          target: agentDefaults.scopeKey,
          set: {
            provider: record.provider,
            userId: record.userId,
            guildId: record.guildId,
            workspaceId: record.workspaceId,
            workspaceKey: record.workspaceKey,
            agentProfileKey: record.agentProfileKey,
            cwd: record.cwd,
            updatedAt: record.updatedAt,
          },
        });
      return {
        ...record,
        createdAt: existing?.createdAt ?? record.createdAt,
      };
    },
  };
}
