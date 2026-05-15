import { RedisConnection, type RedisClient } from 'bullmq';
import type { AgentSessionRecord, AgentSessionStatus } from '../agent-sessions/types.js';
import { logger } from '../logger.js';
import { createConnectionOptions } from '../queue/queue.js';
import {
  agentSessionIndexKey,
  agentSessionKey,
  DEFAULT_WORKER_HEARTBEAT_TTL_MS,
  workerCapabilityIndexKey,
  workerCapabilityKey,
  workerHeartbeatKey,
} from './redisRegistryKeys.js';
import type {
  AgentSessionOwnershipRecord,
  AgentSessionOwnershipRegistryStore,
  RegistryActiveSessionCounts,
  RegistryWorkerCapabilityRecord,
  RegistryWorkerHeartbeat,
  UpdateAgentSessionOwnershipInput,
  WorkerCapabilityRegistryStore,
} from './types.js';

type RedisWorkerCapabilityPayload = {
  version: 1;
  record: RegistryWorkerCapabilityRecord;
};

type RedisWorkerHeartbeatPayload = {
  version: 1;
  heartbeat: RegistryWorkerHeartbeat;
};

type RedisAgentSessionPayloadRecord = AgentSessionRecord & {
  ownerWorkerId?: string;
  ownerWorkerLabel?: string;
  workerClaimedAt?: string;
  ownerStaleSince?: string;
};

type RegistryRedisClient = Pick<
  RedisClient,
  'get' | 'mget' | 'set' | 'del' | 'sadd' | 'srem' | 'smembers'
> & {
  eval(script: string, numkeys: number, ...args: string[]): Promise<unknown>;
};

type RedisRegistryStoreOptions = {
  namespace?: string;
  workerHeartbeatTtlMs?: number;
  client?: RegistryRedisClient;
};

const DEFAULT_NAMESPACE = 'default';
const WORKER_HEARTBEAT_LUA_MARKER = '-- sniptail:refresh-worker-heartbeat';
const SESSION_OWNERSHIP_LUA_MARKER = '-- sniptail:update-session-ownership';

function parseJson(value: string | null): unknown {
  if (!value) return undefined;
  try {
    return JSON.parse(value) as unknown;
  } catch (err) {
    logger.warn({ err }, 'Failed to parse redis registry JSON payload');
    return undefined;
  }
}

function asObject(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }
  return value as Record<string, unknown>;
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function asBoolean(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}

function asStatus(value: unknown): AgentSessionStatus | undefined {
  if (
    value === 'pending' ||
    value === 'active' ||
    value === 'stopped' ||
    value === 'completed' ||
    value === 'failed'
  ) {
    return value;
  }
  return undefined;
}

function parseWorkerCapabilityRecord(
  value: string | null,
): RegistryWorkerCapabilityRecord | undefined {
  const parsed = parseJson(value);
  const payload = asObject(parsed);
  if (!payload || payload.version !== 1) {
    if (parsed !== undefined) {
      logger.warn({ payload: parsed }, 'Skipping unsupported redis worker capability payload');
    }
    return undefined;
  }
  const record = asObject(payload.record);
  const workerId = asString(record?.workerId);
  const enabled = asBoolean(record?.enabled);
  const startedAt = asString(record?.startedAt);
  const lastSeenAt = asString(record?.lastSeenAt);
  const workerLabel = asString(record?.workerLabel);
  const activeRuntimeCount = asNumber(record?.activeRuntimeCount);
  const maxActiveSessions = asNumber(record?.maxActiveSessions);
  const workspaces = Array.isArray(record?.workspaces) ? record.workspaces : undefined;
  const profiles = Array.isArray(record?.profiles) ? record.profiles : undefined;
  if (!workerId || enabled === undefined || !startedAt || !lastSeenAt || !workspaces || !profiles) {
    logger.warn({ payload: parsed }, 'Skipping invalid redis worker capability payload');
    return undefined;
  }
  return {
    workerId,
    ...(workerLabel !== undefined ? { workerLabel } : {}),
    enabled,
    workspaces: workspaces as RegistryWorkerCapabilityRecord['workspaces'],
    profiles: profiles as RegistryWorkerCapabilityRecord['profiles'],
    ...(activeRuntimeCount !== undefined ? { activeRuntimeCount } : {}),
    ...(maxActiveSessions !== undefined ? { maxActiveSessions } : {}),
    startedAt,
    lastSeenAt,
  };
}

function parseAgentSessionPayloadRecord(
  value: string | null,
): RedisAgentSessionPayloadRecord | undefined {
  const parsed = parseJson(value);
  const payload = asObject(parsed);
  if (!payload || payload.version !== 1) {
    if (parsed !== undefined) {
      logger.warn({ payload: parsed }, 'Skipping unsupported redis agent session payload');
    }
    return undefined;
  }
  const record = asObject(payload.record);
  const sessionId = asString(record?.sessionId);
  const provider = asString(record?.provider);
  const channelId = asString(record?.channelId);
  const threadId = asString(record?.threadId);
  const userId = asString(record?.userId);
  const workspaceKey = asString(record?.workspaceKey);
  const agentProfileKey = asString(record?.agentProfileKey);
  const status = asStatus(record?.status);
  const createdAt = asString(record?.createdAt);
  const updatedAt = asString(record?.updatedAt);
  const guildId = asString(record?.guildId);
  const workspaceId = asString(record?.workspaceId);
  const codingAgentSessionId = asString(record?.codingAgentSessionId);
  const cwd = asString(record?.cwd);
  const ownerWorkerId = asString(record?.ownerWorkerId);
  const ownerWorkerLabel = asString(record?.ownerWorkerLabel);
  const workerClaimedAt = asString(record?.workerClaimedAt);
  const ownerStaleSince = asString(record?.ownerStaleSince);
  if (
    !sessionId ||
    !provider ||
    !channelId ||
    !threadId ||
    !userId ||
    !workspaceKey ||
    !agentProfileKey ||
    !status ||
    !createdAt ||
    !updatedAt
  ) {
    logger.warn({ payload: parsed }, 'Skipping invalid redis agent session payload');
    return undefined;
  }
  return {
    sessionId,
    provider: provider as AgentSessionRecord['provider'],
    channelId,
    threadId,
    userId,
    ...(guildId !== undefined ? { guildId } : {}),
    ...(workspaceId !== undefined ? { workspaceId } : {}),
    workspaceKey,
    agentProfileKey,
    ...(codingAgentSessionId !== undefined ? { codingAgentSessionId } : {}),
    ...(cwd !== undefined ? { cwd } : {}),
    status,
    createdAt,
    updatedAt,
    ...(ownerWorkerId !== undefined ? { ownerWorkerId } : {}),
    ...(ownerWorkerLabel !== undefined ? { ownerWorkerLabel } : {}),
    ...(workerClaimedAt !== undefined ? { workerClaimedAt } : {}),
    ...(ownerStaleSince !== undefined ? { ownerStaleSince } : {}),
  };
}

async function getClient(
  connection: RedisConnection | undefined,
  injectedClient: RegistryRedisClient | undefined,
): Promise<RegistryRedisClient> {
  if (injectedClient) {
    return injectedClient;
  }
  if (!connection) {
    throw new Error('Missing Redis connection for registry store.');
  }
  return (await connection.client) as RegistryRedisClient;
}

function createConnection(redisUrl: string, injectedClient: RegistryRedisClient | undefined) {
  return injectedClient ? undefined : new RedisConnection(createConnectionOptions(redisUrl));
}

function toWorkerCapabilityPayload(record: RegistryWorkerCapabilityRecord): string {
  const payload: RedisWorkerCapabilityPayload = {
    version: 1,
    record,
  };
  return JSON.stringify(payload);
}

function toWorkerHeartbeatPayload(heartbeat: RegistryWorkerHeartbeat): string {
  const payload: RedisWorkerHeartbeatPayload = {
    version: 1,
    heartbeat,
  };
  return JSON.stringify(payload);
}

function toOwnershipRecord(
  record: RedisAgentSessionPayloadRecord | undefined,
): AgentSessionOwnershipRecord | undefined {
  if (!record) return undefined;
  return {
    sessionId: record.sessionId,
    ...(record.ownerWorkerId ? { ownerWorkerId: record.ownerWorkerId } : {}),
    ...(record.ownerWorkerLabel ? { ownerWorkerLabel: record.ownerWorkerLabel } : {}),
    ...(record.workerClaimedAt ? { workerClaimedAt: record.workerClaimedAt } : {}),
    ...(record.ownerStaleSince ? { ownerStaleSince: record.ownerStaleSince } : {}),
  };
}

export function createRedisWorkerCapabilityRegistryStore(
  redisUrl: string,
  options: RedisRegistryStoreOptions = {},
): WorkerCapabilityRegistryStore {
  const namespace = options.namespace ?? DEFAULT_NAMESPACE;
  const workerHeartbeatTtlMs = options.workerHeartbeatTtlMs ?? DEFAULT_WORKER_HEARTBEAT_TTL_MS;
  const connection = createConnection(redisUrl, options.client);

  return {
    async upsertWorkerCapability(record: RegistryWorkerCapabilityRecord): Promise<void> {
      const client = await getClient(connection, options.client);
      const capabilityPayload = toWorkerCapabilityPayload(record);
      const heartbeatPayload = toWorkerHeartbeatPayload({
        workerId: record.workerId,
        ...(record.workerLabel ? { workerLabel: record.workerLabel } : {}),
        startedAt: record.startedAt,
        lastSeenAt: record.lastSeenAt,
        ...(record.activeRuntimeCount !== undefined
          ? { activeRuntimeCount: record.activeRuntimeCount }
          : {}),
        ...(record.maxActiveSessions !== undefined
          ? { maxActiveSessions: record.maxActiveSessions }
          : {}),
      });
      await client.set(workerCapabilityKey(namespace, record.workerId), capabilityPayload);
      await client.sadd(workerCapabilityIndexKey(namespace), record.workerId);
      await client.set(
        workerHeartbeatKey(namespace, record.workerId),
        heartbeatPayload,
        'PX',
        String(workerHeartbeatTtlMs),
      );
    },
    async loadWorkerCapability(
      workerId: string,
    ): Promise<RegistryWorkerCapabilityRecord | undefined> {
      const client = await getClient(connection, options.client);
      const value = await client.get(workerCapabilityKey(namespace, workerId));
      return parseWorkerCapabilityRecord(value);
    },
    async listWorkerCapabilities(): Promise<RegistryWorkerCapabilityRecord[]> {
      const client = await getClient(connection, options.client);
      const workerIds = [
        ...new Set(await client.smembers(workerCapabilityIndexKey(namespace))),
      ].sort();
      if (!workerIds.length) {
        return [];
      }
      const values = await client.mget(
        ...workerIds.map((workerId) => workerCapabilityKey(namespace, workerId)),
      );
      const records: RegistryWorkerCapabilityRecord[] = [];
      const staleWorkerIds: string[] = [];
      for (const [index, value] of values.entries()) {
        const workerId = workerIds[index];
        if (!workerId) {
          continue;
        }
        if (!value) {
          staleWorkerIds.push(workerId);
          continue;
        }
        const record = parseWorkerCapabilityRecord(value);
        if (record) {
          records.push(record);
        }
      }
      if (staleWorkerIds.length) {
        await client.srem(workerCapabilityIndexKey(namespace), ...staleWorkerIds);
      }
      return records.sort((left, right) => left.workerId.localeCompare(right.workerId));
    },
    async refreshWorkerHeartbeat(input: RegistryWorkerHeartbeat): Promise<void> {
      const client = await getClient(connection, options.client);
      const capabilityKey = workerCapabilityKey(namespace, input.workerId);
      const heartbeatKey = workerHeartbeatKey(namespace, input.workerId);
      const result = await client.eval(
        [
          WORKER_HEARTBEAT_LUA_MARKER,
          'local capabilityRaw = redis.call("GET", KEYS[1])',
          'if not capabilityRaw then return 0 end',
          'local ok, payload = pcall(cjson.decode, capabilityRaw)',
          'if not ok or type(payload) ~= "table" or payload.version ~= 1 or type(payload.record) ~= "table" then return -1 end',
          'payload.record.workerLabel = ARGV[1] ~= "" and ARGV[1] or cjson.null',
          'payload.record.startedAt = ARGV[2]',
          'payload.record.lastSeenAt = ARGV[3]',
          'payload.record.activeRuntimeCount = ARGV[4] ~= "" and tonumber(ARGV[4]) or cjson.null',
          'payload.record.maxActiveSessions = ARGV[5] ~= "" and tonumber(ARGV[5]) or cjson.null',
          'redis.call("SET", KEYS[1], cjson.encode(payload))',
          'redis.call("SET", KEYS[2], ARGV[6], "PX", ARGV[7])',
          'return 1',
        ].join('\n'),
        2,
        capabilityKey,
        heartbeatKey,
        input.workerLabel ?? '',
        input.startedAt,
        input.lastSeenAt,
        input.activeRuntimeCount !== undefined ? String(input.activeRuntimeCount) : '',
        input.maxActiveSessions !== undefined ? String(input.maxActiveSessions) : '',
        toWorkerHeartbeatPayload(input),
        String(workerHeartbeatTtlMs),
      );
      if (result === 0) {
        throw new Error(
          `Cannot refresh worker heartbeat before capability registration for worker "${input.workerId}".`,
        );
      }
      if (result !== 1) {
        throw new Error(`Worker capability payload for "${input.workerId}" is invalid.`);
      }
    },
    async deleteWorkerCapability(workerId: string): Promise<void> {
      const client = await getClient(connection, options.client);
      await client.del(
        workerCapabilityKey(namespace, workerId),
        workerHeartbeatKey(namespace, workerId),
      );
      await client.srem(workerCapabilityIndexKey(namespace), workerId);
    },
  };
}

export function createRedisAgentSessionOwnershipRegistryStore(
  redisUrl: string,
  options: RedisRegistryStoreOptions = {},
): AgentSessionOwnershipRegistryStore {
  const namespace = options.namespace ?? DEFAULT_NAMESPACE;
  const connection = createConnection(redisUrl, options.client);

  return {
    async loadSessionOwnership(
      sessionId: string,
    ): Promise<AgentSessionOwnershipRecord | undefined> {
      const client = await getClient(connection, options.client);
      const value = await client.get(agentSessionKey(namespace, sessionId));
      return toOwnershipRecord(parseAgentSessionPayloadRecord(value));
    },
    async updateSessionOwnership(input: UpdateAgentSessionOwnershipInput): Promise<void> {
      const client = await getClient(connection, options.client);
      const result = await client.eval(
        [
          SESSION_OWNERSHIP_LUA_MARKER,
          'local sessionRaw = redis.call("GET", KEYS[1])',
          'if not sessionRaw then return 0 end',
          'local ok, payload = pcall(cjson.decode, sessionRaw)',
          'if not ok or type(payload) ~= "table" or payload.version ~= 1 or type(payload.record) ~= "table" then return -1 end',
          'payload.record.ownerWorkerId = ARGV[1] ~= "" and ARGV[1] or cjson.null',
          'payload.record.ownerWorkerLabel = ARGV[2] ~= "" and ARGV[2] or cjson.null',
          'payload.record.workerClaimedAt = ARGV[3] ~= "" and ARGV[3] or cjson.null',
          'payload.record.ownerStaleSince = ARGV[4] ~= "" and ARGV[4] or cjson.null',
          'redis.call("SET", KEYS[1], cjson.encode(payload))',
          'return 1',
        ].join('\n'),
        1,
        agentSessionKey(namespace, input.sessionId),
        input.ownerWorkerId ?? '',
        input.ownerWorkerLabel ?? '',
        input.workerClaimedAt ?? '',
        input.ownerStaleSince ?? '',
      );
      if (result === 0) {
        throw new Error(`Agent session "${input.sessionId}" was not found.`);
      }
      if (result !== 1) {
        throw new Error(`Agent session "${input.sessionId}" is invalid.`);
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

      const client = await getClient(connection, options.client);
      const sessionIds = [
        ...new Set(await client.smembers(agentSessionIndexKey(namespace))),
      ].sort();
      if (!sessionIds.length) {
        return counts;
      }
      const values = await client.mget(
        ...sessionIds.map((sessionId) => agentSessionKey(namespace, sessionId)),
      );
      const staleSessionIds: string[] = [];
      const workerIdSet = new Set(uniqueWorkerIds);

      for (const [index, value] of values.entries()) {
        const sessionId = sessionIds[index];
        if (!sessionId) {
          continue;
        }
        if (!value) {
          staleSessionIds.push(sessionId);
          continue;
        }
        const record = parseAgentSessionPayloadRecord(value);
        if (!record) {
          continue;
        }
        if (!record.ownerWorkerId || !workerIdSet.has(record.ownerWorkerId)) {
          continue;
        }
        if (record.status !== 'pending' && record.status !== 'active') {
          continue;
        }
        counts[record.ownerWorkerId] = (counts[record.ownerWorkerId] ?? 0) + 1;
      }

      if (staleSessionIds.length) {
        await client.srem(agentSessionIndexKey(namespace), ...staleSessionIds);
      }
      return counts;
    },
  };
}
