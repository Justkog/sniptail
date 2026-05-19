import { RedisConnection, type RedisClient } from 'bullmq';
import { logger } from '../logger.js';
import { createConnectionOptions } from '../queue/queue.js';
import { agentSessionIndexKey, agentSessionKey } from '../registry/redisRegistryKeys.js';
import type {
  AgentSessionRecord,
  AgentSessionStatus,
  AgentSessionStore,
  CreateAgentSessionInput,
} from './types.js';

type RedisAgentSessionPayload = {
  version: 1;
  record: AgentSessionRecord;
};

type RegistryRedisClient = Pick<
  RedisClient,
  'get' | 'mget' | 'set' | 'del' | 'sadd' | 'srem' | 'smembers'
> & {
  eval(script: string, numkeys: number, ...args: string[]): Promise<unknown>;
};

type RedisAgentSessionStoreOptions = {
  namespace?: string;
  client?: RegistryRedisClient;
};

const DEFAULT_NAMESPACE = 'default';
const SESSION_STATUS_LUA_MARKER = '-- sniptail:update-agent-session-status';
const SESSION_CODING_ID_LUA_MARKER = '-- sniptail:update-agent-session-coding-id';
const SESSION_OWNERSHIP_LUA_MARKER = '-- sniptail:update-agent-session-ownership-record';

function parseJson(value: string | null): unknown {
  if (!value) return undefined;
  try {
    return JSON.parse(value) as unknown;
  } catch (err) {
    logger.warn({ err }, 'Failed to parse redis agent session JSON payload');
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

function parseAgentSessionRecord(value: string | null): AgentSessionRecord | undefined {
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

  const guildId = asString(record?.guildId);
  const workspaceId = asString(record?.workspaceId);
  const codingAgentSessionId = asString(record?.codingAgentSessionId);
  const cwd = asString(record?.cwd);
  const ownerWorkerId = asString(record?.ownerWorkerId);
  const ownerWorkerLabel = asString(record?.ownerWorkerLabel);
  const workerClaimedAt = asString(record?.workerClaimedAt);
  const ownerStaleSince = asString(record?.ownerStaleSince);

  return {
    sessionId,
    provider: provider as AgentSessionRecord['provider'],
    channelId,
    threadId,
    userId,
    ...(guildId ? { guildId } : {}),
    ...(workspaceId ? { workspaceId } : {}),
    workspaceKey,
    agentProfileKey,
    ...(codingAgentSessionId ? { codingAgentSessionId } : {}),
    ...(cwd ? { cwd } : {}),
    ...(ownerWorkerId ? { ownerWorkerId } : {}),
    ...(ownerWorkerLabel ? { ownerWorkerLabel } : {}),
    ...(workerClaimedAt ? { workerClaimedAt } : {}),
    ...(ownerStaleSince ? { ownerStaleSince } : {}),
    status,
    createdAt,
    updatedAt,
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
    throw new Error('Missing Redis connection for agent session store.');
  }
  return (await connection.client) as RegistryRedisClient;
}

function createConnection(redisUrl: string, injectedClient: RegistryRedisClient | undefined) {
  return injectedClient ? undefined : new RedisConnection(createConnectionOptions(redisUrl));
}

function toPayload(record: AgentSessionRecord): string {
  const payload: RedisAgentSessionPayload = { version: 1, record };
  return JSON.stringify(payload);
}

export function createRedisAgentSessionStore(
  redisUrl: string,
  options: RedisAgentSessionStoreOptions = {},
): AgentSessionStore {
  const namespace = options.namespace ?? DEFAULT_NAMESPACE;
  const connection = createConnection(redisUrl, options.client);

  return {
    kind: 'redis',
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
      const client = await getClient(connection, options.client);
      await client.set(agentSessionKey(namespace, record.sessionId), toPayload(record));
      await client.sadd(agentSessionIndexKey(namespace), record.sessionId);
      return record;
    },
    async loadSession(sessionId: string): Promise<AgentSessionRecord | undefined> {
      const client = await getClient(connection, options.client);
      const value = await client.get(agentSessionKey(namespace, sessionId));
      return parseAgentSessionRecord(value);
    },
    async findSessionByThread(input: {
      provider: AgentSessionRecord['provider'];
      threadId: string;
    }): Promise<AgentSessionRecord | undefined> {
      const client = await getClient(connection, options.client);
      const sessionIds = [
        ...new Set(await client.smembers(agentSessionIndexKey(namespace))),
      ].sort();
      if (!sessionIds.length) {
        return undefined;
      }

      const values = await client.mget(
        ...sessionIds.map((sessionId) => agentSessionKey(namespace, sessionId)),
      );
      const staleSessionIds: string[] = [];
      let latest: AgentSessionRecord | undefined;

      for (const [index, value] of values.entries()) {
        const sessionId = sessionIds[index];
        if (!sessionId) {
          continue;
        }
        if (!value) {
          staleSessionIds.push(sessionId);
          continue;
        }
        const record = parseAgentSessionRecord(value);
        if (!record) {
          continue;
        }
        if (record.provider !== input.provider || record.threadId !== input.threadId) {
          continue;
        }
        if (!latest || record.updatedAt > latest.updatedAt) {
          latest = record;
        }
      }

      if (staleSessionIds.length) {
        await client.srem(agentSessionIndexKey(namespace), ...staleSessionIds);
      }
      return latest;
    },
    async updateSessionStatus(
      sessionId: string,
      status: AgentSessionStatus,
    ): Promise<AgentSessionRecord | undefined> {
      const client = await getClient(connection, options.client);
      const updatedAt = new Date().toISOString();
      const result = await client.eval(
        [
          SESSION_STATUS_LUA_MARKER,
          'local sessionRaw = redis.call("GET", KEYS[1])',
          'if not sessionRaw then return 0 end',
          'local ok, payload = pcall(cjson.decode, sessionRaw)',
          'if not ok or type(payload) ~= "table" or payload.version ~= 1 or type(payload.record) ~= "table" then return -1 end',
          'payload.record.status = ARGV[1]',
          'payload.record.updatedAt = ARGV[2]',
          'redis.call("SET", KEYS[1], cjson.encode(payload))',
          'return 1',
        ].join('\n'),
        1,
        agentSessionKey(namespace, sessionId),
        status,
        updatedAt,
      );
      if (result === 0) {
        return undefined;
      }
      if (result !== 1) {
        throw new Error(`Agent session "${sessionId}" is invalid.`);
      }
      return this.loadSession(sessionId);
    },
    async updateCodingAgentSessionId(
      sessionId: string,
      codingAgentSessionId: string,
    ): Promise<AgentSessionRecord | undefined> {
      const client = await getClient(connection, options.client);
      const updatedAt = new Date().toISOString();
      const result = await client.eval(
        [
          SESSION_CODING_ID_LUA_MARKER,
          'local sessionRaw = redis.call("GET", KEYS[1])',
          'if not sessionRaw then return 0 end',
          'local ok, payload = pcall(cjson.decode, sessionRaw)',
          'if not ok or type(payload) ~= "table" or payload.version ~= 1 or type(payload.record) ~= "table" then return -1 end',
          'payload.record.codingAgentSessionId = ARGV[1]',
          'payload.record.updatedAt = ARGV[2]',
          'redis.call("SET", KEYS[1], cjson.encode(payload))',
          'return 1',
        ].join('\n'),
        1,
        agentSessionKey(namespace, sessionId),
        codingAgentSessionId,
        updatedAt,
      );
      if (result === 0) {
        return undefined;
      }
      if (result !== 1) {
        throw new Error(`Agent session "${sessionId}" is invalid.`);
      }
      return this.loadSession(sessionId);
    },
    async updateSessionOwnership(
      sessionId: string,
      ownership,
    ): Promise<AgentSessionRecord | undefined> {
      const client = await getClient(connection, options.client);
      const updatedAt = new Date().toISOString();
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
          'payload.record.updatedAt = ARGV[5]',
          'redis.call("SET", KEYS[1], cjson.encode(payload))',
          'return 1',
        ].join('\n'),
        1,
        agentSessionKey(namespace, sessionId),
        ownership.ownerWorkerId ?? '',
        ownership.ownerWorkerLabel ?? '',
        ownership.workerClaimedAt ?? '',
        ownership.ownerStaleSince ?? '',
        updatedAt,
      );
      if (result === 0) {
        return undefined;
      }
      if (result !== 1) {
        throw new Error(`Agent session "${sessionId}" is invalid.`);
      }
      return this.loadSession(sessionId);
    },
  };
}
