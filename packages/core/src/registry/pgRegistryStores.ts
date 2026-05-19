import { and, asc, count, eq, inArray } from 'drizzle-orm';
import type { PgJobRegistryClient } from '../db/index.js';
import { agentSessions, workerAgentCapabilities } from '../db/pg/schema.js';
import { logger } from '../logger.js';
import type {
  AgentSessionOwnershipRegistryStore,
  AgentSessionOwnershipRecord,
  RegistryActiveSessionCounts,
  RegistryWorkerCapabilityRecord,
  RegistryWorkerHeartbeat,
  UpdateAgentSessionOwnershipInput,
  WorkerCapabilityRegistryStore,
} from './types.js';

type WorkerCapabilityRow = typeof workerAgentCapabilities.$inferSelect;
type AgentSessionOwnershipRow = Pick<
  typeof agentSessions.$inferSelect,
  'sessionId' | 'ownerWorkerId' | 'ownerWorkerLabel' | 'workerClaimedAt' | 'ownerStaleSince'
>;

function parseWorkerCapabilityValue(value: unknown): RegistryWorkerCapabilityRecord | undefined {
  if (!value) return undefined;
  if (typeof value === 'string') {
    try {
      return JSON.parse(value) as RegistryWorkerCapabilityRecord;
    } catch (err) {
      logger.warn({ err }, 'Failed to parse pg worker capability JSON');
      return undefined;
    }
  }
  if (typeof value === 'object') {
    return value as RegistryWorkerCapabilityRecord;
  }
  return undefined;
}

function parseWorkerCapability(
  row: WorkerCapabilityRow | undefined,
): RegistryWorkerCapabilityRecord | undefined {
  if (!row) return undefined;
  const parsed = parseWorkerCapabilityValue(row.capabilityJson);
  if (!parsed) {
    return undefined;
  }
  return {
    ...parsed,
    workerId: row.workerId,
    enabled: row.enabled,
    startedAt: row.startedAt,
    lastSeenAt: row.lastSeenAt,
    ...(row.workerLabel ? { workerLabel: row.workerLabel } : {}),
    ...(row.activeRuntimeCount !== null ? { activeRuntimeCount: row.activeRuntimeCount } : {}),
    ...(row.maxActiveSessions !== null ? { maxActiveSessions: row.maxActiveSessions } : {}),
  };
}

function fromOwnershipRow(
  row: AgentSessionOwnershipRow | undefined,
): AgentSessionOwnershipRecord | undefined {
  if (!row) return undefined;
  return {
    sessionId: row.sessionId,
    ...(row.ownerWorkerId ? { ownerWorkerId: row.ownerWorkerId } : {}),
    ...(row.ownerWorkerLabel ? { ownerWorkerLabel: row.ownerWorkerLabel } : {}),
    ...(row.workerClaimedAt ? { workerClaimedAt: row.workerClaimedAt } : {}),
    ...(row.ownerStaleSince ? { ownerStaleSince: row.ownerStaleSince } : {}),
  };
}

export function createPgWorkerCapabilityRegistryStore(
  client: PgJobRegistryClient,
): WorkerCapabilityRegistryStore {
  return {
    async upsertWorkerCapability(record: RegistryWorkerCapabilityRecord): Promise<void> {
      await client.db
        .insert(workerAgentCapabilities)
        .values({
          workerId: record.workerId,
          workerLabel: record.workerLabel ?? null,
          enabled: record.enabled,
          capabilityJson: record,
          startedAt: record.startedAt,
          lastSeenAt: record.lastSeenAt,
          activeRuntimeCount: record.activeRuntimeCount ?? null,
          maxActiveSessions: record.maxActiveSessions ?? null,
        })
        .onConflictDoUpdate({
          target: workerAgentCapabilities.workerId,
          set: {
            workerLabel: record.workerLabel ?? null,
            enabled: record.enabled,
            capabilityJson: record,
            startedAt: record.startedAt,
            lastSeenAt: record.lastSeenAt,
            activeRuntimeCount: record.activeRuntimeCount ?? null,
            maxActiveSessions: record.maxActiveSessions ?? null,
          },
        });
    },
    async loadWorkerCapability(
      workerId: string,
    ): Promise<RegistryWorkerCapabilityRecord | undefined> {
      const rows = await client.db
        .select()
        .from(workerAgentCapabilities)
        .where(eq(workerAgentCapabilities.workerId, workerId))
        .limit(1);
      return parseWorkerCapability(rows[0]);
    },
    async listWorkerCapabilities(): Promise<RegistryWorkerCapabilityRecord[]> {
      const rows = await client.db
        .select()
        .from(workerAgentCapabilities)
        .orderBy(asc(workerAgentCapabilities.workerId));
      const records: RegistryWorkerCapabilityRecord[] = [];
      for (const row of rows) {
        const record = parseWorkerCapability(row);
        if (record) {
          records.push(record);
        }
      }
      return records;
    },
    async refreshWorkerHeartbeat(input: RegistryWorkerHeartbeat): Promise<void> {
      const rows = await client.db
        .update(workerAgentCapabilities)
        .set({
          workerLabel: input.workerLabel ?? null,
          startedAt: input.startedAt,
          lastSeenAt: input.lastSeenAt,
          activeRuntimeCount: input.activeRuntimeCount ?? null,
          maxActiveSessions: input.maxActiveSessions ?? null,
        })
        .where(eq(workerAgentCapabilities.workerId, input.workerId))
        .returning({ workerId: workerAgentCapabilities.workerId });
      if (!rows.length) {
        throw new Error(
          `Cannot refresh worker heartbeat before capability registration for worker "${input.workerId}".`,
        );
      }
    },
    async deleteWorkerCapability(workerId: string): Promise<void> {
      await client.db
        .delete(workerAgentCapabilities)
        .where(eq(workerAgentCapabilities.workerId, workerId));
    },
  };
}

export function createPgAgentSessionOwnershipRegistryStore(
  client: PgJobRegistryClient,
): AgentSessionOwnershipRegistryStore {
  return {
    async loadSessionOwnership(
      sessionId: string,
    ): Promise<AgentSessionOwnershipRecord | undefined> {
      const rows = await client.db
        .select({
          sessionId: agentSessions.sessionId,
          ownerWorkerId: agentSessions.ownerWorkerId,
          ownerWorkerLabel: agentSessions.ownerWorkerLabel,
          workerClaimedAt: agentSessions.workerClaimedAt,
          ownerStaleSince: agentSessions.ownerStaleSince,
        })
        .from(agentSessions)
        .where(eq(agentSessions.sessionId, sessionId))
        .limit(1);
      return fromOwnershipRow(rows[0]);
    },
    async updateSessionOwnership(input: UpdateAgentSessionOwnershipInput): Promise<void> {
      const rows = await client.db
        .update(agentSessions)
        .set({
          ownerWorkerId: input.ownerWorkerId ?? null,
          ownerWorkerLabel: input.ownerWorkerLabel ?? null,
          workerClaimedAt: input.workerClaimedAt ?? null,
          ownerStaleSince: input.ownerStaleSince ?? null,
        })
        .where(eq(agentSessions.sessionId, input.sessionId))
        .returning({ sessionId: agentSessions.sessionId });
      if (!rows.length) {
        throw new Error(`Agent session "${input.sessionId}" was not found.`);
      }
    },
    async listActiveSessionCountsByWorkerIds(
      workerIds: string[],
    ): Promise<RegistryActiveSessionCounts> {
      const uniqueWorkerIds = [...new Set(workerIds)];
      const counts = Object.fromEntries(uniqueWorkerIds.map((workerId) => [workerId, 0]));
      if (!uniqueWorkerIds.length) {
        return counts;
      }

      const rows = await client.db
        .select({
          workerId: agentSessions.ownerWorkerId,
          activeSessionCount: count(),
        })
        .from(agentSessions)
        .where(
          and(
            inArray(agentSessions.ownerWorkerId, uniqueWorkerIds),
            inArray(agentSessions.status, ['pending', 'active']),
          ),
        )
        .groupBy(agentSessions.ownerWorkerId);

      for (const row of rows) {
        if (row.workerId) {
          counts[row.workerId] = Number(row.activeSessionCount);
        }
      }
      return counts;
    },
  };
}
