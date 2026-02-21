import { RedisConnection, type RedisClient } from 'bullmq';
import { logger } from '../logger.js';
import { createConnectionOptions } from '../queue/queue.js';
import type { JobRecord, JobRegistryStore } from './registryTypes.js';

const DEFAULT_SCAN_COUNT = 200;

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
