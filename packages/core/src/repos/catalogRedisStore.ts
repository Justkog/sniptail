import { RedisConnection, type RedisClient } from 'bullmq';
import { logger } from '../logger.js';
import { createConnectionOptions } from '../queue/queue.js';
import type { RepoCatalogStore, RepoProvider, RepoRow } from './catalogTypes.js';

const REPO_KEY_PREFIX = 'repo:';
const DEFAULT_SCAN_COUNT = 200;

type RepoRedisClient = Pick<RedisClient, 'scan' | 'mget' | 'set'>;

function toRedisKey(repoKey: string): string {
  return `${REPO_KEY_PREFIX}${repoKey}`;
}

function isRepoProvider(value: unknown): value is RepoProvider {
  return value === 'github' || value === 'gitlab' || value === 'local';
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

function parseRepoRow(value: string): RepoRow | undefined {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return undefined;

    const row = parsed as Record<string, unknown>;
    const repoKey = asString(row.repoKey);
    const provider = row.provider;
    const baseBranch = asString(row.baseBranch);
    const isActive = asBoolean(row.isActive);

    if (!repoKey || !isRepoProvider(provider) || !baseBranch || isActive === undefined) {
      return undefined;
    }

    const sshUrl = asString(row.sshUrl);
    const localPath = asString(row.localPath);
    const projectId = asNumber(row.projectId);

    return {
      repoKey,
      provider,
      ...(sshUrl !== undefined ? { sshUrl } : {}),
      ...(localPath !== undefined ? { localPath } : {}),
      ...(projectId !== undefined ? { projectId } : {}),
      baseBranch,
      isActive,
    };
  } catch (err) {
    logger.warn({ err }, 'Failed to parse redis repo catalog row');
    return undefined;
  }
}

async function getClient(connection: RedisConnection): Promise<RepoRedisClient> {
  return (await connection.client) as RepoRedisClient;
}

async function scanRepoKeys(client: RepoRedisClient): Promise<string[]> {
  const keys: string[] = [];
  let cursor = '0';
  do {
    const [nextCursor, batch] = await client.scan(
      cursor,
      'MATCH',
      `${REPO_KEY_PREFIX}*`,
      'COUNT',
      String(DEFAULT_SCAN_COUNT),
    );
    cursor = nextCursor;
    if (batch.length) keys.push(...batch);
  } while (cursor !== '0');
  return keys;
}

export function createRedisRepoCatalogStore(redisUrl: string): RepoCatalogStore {
  const connection = new RedisConnection(createConnectionOptions(redisUrl));

  return {
    kind: 'redis',
    async listActiveRows(): Promise<RepoRow[]> {
      const client = await getClient(connection);
      const keys = await scanRepoKeys(client);
      if (!keys.length) return [];

      const values = await client.mget(...keys);
      const rows: RepoRow[] = [];
      for (const value of values) {
        if (!value) continue;
        const parsed = parseRepoRow(value);
        if (parsed && parsed.isActive) rows.push(parsed);
      }
      rows.sort((a, b) => a.repoKey.localeCompare(b.repoKey));
      return rows;
    },
    async upsertRow(row: RepoRow): Promise<void> {
      const client = await getClient(connection);
      await client.set(toRedisKey(row.repoKey), JSON.stringify(row));
    },
  };
}
