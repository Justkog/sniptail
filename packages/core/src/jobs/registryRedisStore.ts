import { RedisConnection, type RedisClient } from 'bullmq';
import { logger } from '../logger.js';
import { createConnectionOptions } from '../queue/queue.js';
import type {
  JobRecord,
  JobRecordCleanupQuery,
  JobRecordThreadLookup,
  JobRegistryStore,
} from './registryTypes.js';

const DEFAULT_SCAN_COUNT = 200;
const JOB_KEY_PREFIX = 'job:';

function parseRedisRecord(value: string | null): JobRecord | undefined {
  if (!value) return undefined;
  try {
    return JSON.parse(value) as JobRecord;
  } catch (err) {
    logger.warn({ err }, 'Failed to parse redis job record JSON');
    return undefined;
  }
}

type RegistryRedisClient = Pick<RedisClient, 'scan' | 'mget' | 'get' | 'set' | 'del'> & {
  eval(script: string, numkeys: number, ...args: string[]): Promise<unknown>;
};

async function getClient(connection: RedisConnection): Promise<RegistryRedisClient> {
  return (await connection.client) as RegistryRedisClient;
}

async function scanKeysByPrefix(client: RegistryRedisClient, prefix: string): Promise<string[]> {
  const keys: string[] = [];
  let cursor = '0';
  do {
    const [nextCursor, batch] = await client.scan(
      cursor,
      'MATCH',
      `${prefix}*`,
      'COUNT',
      String(DEFAULT_SCAN_COUNT),
    );
    cursor = nextCursor;
    if (batch.length) keys.push(...batch);
  } while (cursor !== '0');
  return keys;
}

function matchesThreadLookup(record: JobRecord, input: JobRecordThreadLookup): boolean {
  const channel = record.job.channel;
  if (!channel || channel.provider !== input.provider) {
    return false;
  }
  if (channel.threadId !== input.threadId) {
    return false;
  }
  if (input.provider === 'discord') {
    const channelIdMatches =
      channel.channelId === input.channelId ||
      channel.channelId === input.threadId ||
      input.channelId === input.threadId;
    if (!channelIdMatches) {
      return false;
    }
  } else if (channel.channelId !== input.channelId) {
    return false;
  }
  if (input.agentId && !record.job.agentThreadIds?.[input.agentId]) {
    return false;
  }
  if (input.types?.length && !input.types.includes(record.job.type)) {
    return false;
  }
  return true;
}

export function createRedisJobRegistryStore(redisUrl: string): JobRegistryStore {
  const connection = new RedisConnection(createConnectionOptions(redisUrl));

  return {
    kind: 'redis',
    async loadAllRecordsByPrefix(prefix: string): Promise<JobRecord[]> {
      const client = await getClient(connection);
      const keys = await scanKeysByPrefix(client, prefix);
      if (!keys.length) return [];
      const values = await client.mget(...keys);
      const records: JobRecord[] = [];
      for (const value of values) {
        const record = parseRedisRecord(value);
        if (record) records.push(record);
      }
      return records;
    },
    async loadRecordByKey(key: string): Promise<JobRecord | undefined> {
      const client = await getClient(connection);
      const value = await client.get(key);
      return parseRedisRecord(value);
    },
    async findLatestJobRecordByChannelThread(
      input: JobRecordThreadLookup,
    ): Promise<JobRecord | undefined> {
      const records = await this.loadAllRecordsByPrefix(JOB_KEY_PREFIX);
      let latest: JobRecord | undefined;
      let latestTime = -1;
      for (const record of records) {
        if (!matchesThreadLookup(record, input)) continue;
        const createdTime = Date.parse(record.createdAt);
        if (Number.isNaN(createdTime)) continue;
        if (createdTime > latestTime) {
          latest = record;
          latestTime = createdTime;
        }
      }
      return latest;
    },
    async listJobKeysCreatedBefore(cutoffIso: string): Promise<string[]> {
      const client = await getClient(connection);
      const keys = await scanKeysByPrefix(client, JOB_KEY_PREFIX);
      if (!keys.length) return [];
      const values = await client.mget(...keys);
      const cutoffTime = Date.parse(cutoffIso);
      const matches: string[] = [];
      for (const [index, value] of values.entries()) {
        const record = parseRedisRecord(value);
        if (!record?.createdAt) continue;
        const createdTime = Date.parse(record.createdAt);
        if (Number.isNaN(createdTime) || createdTime >= cutoffTime) continue;
        const key = keys[index];
        if (key) matches.push(key);
      }
      return matches;
    },
    async countJobRecordsByTypes(types: string[]): Promise<number> {
      if (!types.length) return 0;
      const records = await this.loadAllRecordsByPrefix(JOB_KEY_PREFIX);
      return records.filter((record) => types.includes(record.job.type)).length;
    },
    async listJobRecordsForCleanup(input: JobRecordCleanupQuery): Promise<JobRecord[]> {
      if (!input.types.length) return [];
      const records = await this.loadAllRecordsByPrefix(JOB_KEY_PREFIX);
      const cutoffTime = input.olderThan ? Date.parse(input.olderThan) : undefined;
      const filtered = records
        .filter((record) => input.types.includes(record.job.type))
        .filter((record) => {
          if (cutoffTime === undefined) return true;
          const createdTime = Date.parse(record.createdAt);
          return !Number.isNaN(createdTime) && createdTime <= cutoffTime;
        })
        .sort((left, right) => Date.parse(left.createdAt) - Date.parse(right.createdAt));
      if (typeof input.limit === 'number' && Number.isFinite(input.limit) && input.limit > 0) {
        return filtered.slice(0, Math.trunc(input.limit));
      }
      return filtered;
    },
    async upsertRecord(key: string, record: JobRecord): Promise<void> {
      const client = await getClient(connection);
      await client.set(key, JSON.stringify(record));
    },
    async conditionalUpdateRecord(
      key: string,
      record: JobRecord,
      condition: { statusEquals: string },
    ): Promise<boolean> {
      const client = await getClient(connection);
      const lua = [
        'local v = redis.call("GET", KEYS[1])',
        'if not v then return 0 end',
        'local ok, t = pcall(cjson.decode, v)',
        'if not ok then return 0 end',
        'if t.status ~= ARGV[2] then return 0 end',
        'redis.call("SET", KEYS[1], ARGV[1])',
        'return 1',
      ].join('\n');
      const result = await client.eval(lua, 1, key, JSON.stringify(record), condition.statusEquals);
      return result === 1;
    },
    async deleteRecordsByKeys(keys: string[]): Promise<void> {
      if (!keys.length) return;
      const client = await getClient(connection);
      await client.del(...keys);
    },
    async deleteRecordByKey(key: string): Promise<void> {
      const client = await getClient(connection);
      await client.del(key);
    },
  };
}
