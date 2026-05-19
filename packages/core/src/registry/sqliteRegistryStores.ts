import { asc, eq } from 'drizzle-orm';
import type { SqliteJobRegistryClient } from '../db/index.js';
import { agentSessions, workerAgentCapabilities } from '../db/sqlite/schema.js';
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

function parseWorkerCapability(
  row: WorkerCapabilityRow | undefined,
): RegistryWorkerCapabilityRecord | undefined {
  if (!row) return undefined;
  try {
    const parsed = JSON.parse(row.capabilityJson) as RegistryWorkerCapabilityRecord;
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
  } catch (err) {
    logger.warn({ err, workerId: row.workerId }, 'Failed to parse sqlite worker capability JSON');
    return undefined;
  }
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

export function createSqliteWorkerCapabilityRegistryStore(
  client: SqliteJobRegistryClient,
): WorkerCapabilityRegistryStore {
  return {
    async upsertWorkerCapability(record: RegistryWorkerCapabilityRecord): Promise<void> {
      await client.db
        .insert(workerAgentCapabilities)
        .values({
          workerId: record.workerId,
          workerLabel: record.workerLabel ?? null,
          enabled: record.enabled,
          capabilityJson: JSON.stringify(record),
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
            capabilityJson: JSON.stringify(record),
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
    // eslint-disable-next-line @typescript-eslint/require-await
    async refreshWorkerHeartbeat(input: RegistryWorkerHeartbeat): Promise<void> {
      const result = client.raw
        .prepare(
          [
            'UPDATE worker_agent_capabilities',
            'SET worker_label = ?,',
            'started_at = ?,',
            'last_seen_at = ?,',
            'active_runtime_count = ?,',
            'max_active_sessions = ?',
            'WHERE worker_id = ?',
          ].join(' '),
        )
        .run(
          input.workerLabel ?? null,
          input.startedAt,
          input.lastSeenAt,
          input.activeRuntimeCount ?? null,
          input.maxActiveSessions ?? null,
          input.workerId,
        );
      if (result.changes < 1) {
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

export function createSqliteAgentSessionOwnershipRegistryStore(
  client: SqliteJobRegistryClient,
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
      const result = await client.db
        .update(agentSessions)
        .set({
          ownerWorkerId: input.ownerWorkerId ?? null,
          ownerWorkerLabel: input.ownerWorkerLabel ?? null,
          workerClaimedAt: input.workerClaimedAt ?? null,
          ownerStaleSince: input.ownerStaleSince ?? null,
        })
        .where(eq(agentSessions.sessionId, input.sessionId));
      if (result.changes < 1) {
        throw new Error(`Agent session "${input.sessionId}" was not found.`);
      }
    },
    // eslint-disable-next-line @typescript-eslint/require-await
    async listActiveSessionCountsByWorkerIds(
      workerIds: string[],
    ): Promise<RegistryActiveSessionCounts> {
      const uniqueWorkerIds = [...new Set(workerIds)];
      const counts = Object.fromEntries(uniqueWorkerIds.map((workerId) => [workerId, 0]));
      if (!uniqueWorkerIds.length) {
        return counts;
      }

      const workerIdPlaceholders = uniqueWorkerIds.map(() => '?').join(', ');
      const rows = client.raw
        .prepare(
          [
            'SELECT owner_worker_id AS worker_id, COUNT(*) AS active_session_count',
            'FROM agent_sessions',
            `WHERE owner_worker_id IN (${workerIdPlaceholders})`,
            "AND status IN ('pending', 'active')",
            'GROUP BY owner_worker_id',
          ].join(' '),
        )
        .all(...uniqueWorkerIds) as Array<{
        worker_id: string;
        active_session_count: number;
      }>;

      for (const row of rows) {
        counts[row.worker_id] = Number(row.active_session_count);
      }
      return counts;
    },
  };
}
