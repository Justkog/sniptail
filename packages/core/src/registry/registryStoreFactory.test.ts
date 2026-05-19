import { beforeEach, describe, expect, it, vi } from 'vitest';

const hoisted = vi.hoisted(() => {
  const sqliteWorkerStore = {
    upsertWorkerCapability: vi.fn(),
    loadWorkerCapability: vi.fn(),
    listWorkerCapabilities: vi.fn(),
    refreshWorkerHeartbeat: vi.fn(),
    deleteWorkerCapability: vi.fn(),
  };
  const sqliteOwnershipStore = {
    loadSessionOwnership: vi.fn(),
    updateSessionOwnership: vi.fn(),
    listActiveSessionCountsByWorkerIds: vi.fn(),
  };
  const pgWorkerStore = {
    upsertWorkerCapability: vi.fn(),
    loadWorkerCapability: vi.fn(),
    listWorkerCapabilities: vi.fn(),
    refreshWorkerHeartbeat: vi.fn(),
    deleteWorkerCapability: vi.fn(),
  };
  const pgOwnershipStore = {
    loadSessionOwnership: vi.fn(),
    updateSessionOwnership: vi.fn(),
    listActiveSessionCountsByWorkerIds: vi.fn(),
  };
  const redisWorkerStore = {
    upsertWorkerCapability: vi.fn(),
    loadWorkerCapability: vi.fn(),
    listWorkerCapabilities: vi.fn(),
    refreshWorkerHeartbeat: vi.fn(),
    deleteWorkerCapability: vi.fn(),
  };
  const redisOwnershipStore = {
    loadSessionOwnership: vi.fn(),
    updateSessionOwnership: vi.fn(),
    listActiveSessionCountsByWorkerIds: vi.fn(),
  };

  return {
    loadCoreConfig: vi.fn(),
    getJobRegistryDb: vi.fn(),
    createSqliteWorkerCapabilityRegistryStore: vi.fn(() => sqliteWorkerStore),
    createSqliteAgentSessionOwnershipRegistryStore: vi.fn(() => sqliteOwnershipStore),
    createPgWorkerCapabilityRegistryStore: vi.fn(() => pgWorkerStore),
    createPgAgentSessionOwnershipRegistryStore: vi.fn(() => pgOwnershipStore),
    createRedisWorkerCapabilityRegistryStore: vi.fn(() => redisWorkerStore),
    createRedisAgentSessionOwnershipRegistryStore: vi.fn(() => redisOwnershipStore),
    sqliteWorkerStore,
    sqliteOwnershipStore,
    pgWorkerStore,
    pgOwnershipStore,
    redisWorkerStore,
    redisOwnershipStore,
  };
});

vi.mock('../config/config.js', () => ({
  loadCoreConfig: hoisted.loadCoreConfig,
}));

vi.mock('../db/index.js', () => ({
  getJobRegistryDb: hoisted.getJobRegistryDb,
}));

vi.mock('./sqliteRegistryStores.js', () => ({
  createSqliteWorkerCapabilityRegistryStore: hoisted.createSqliteWorkerCapabilityRegistryStore,
  createSqliteAgentSessionOwnershipRegistryStore:
    hoisted.createSqliteAgentSessionOwnershipRegistryStore,
}));

vi.mock('./pgRegistryStores.js', () => ({
  createPgWorkerCapabilityRegistryStore: hoisted.createPgWorkerCapabilityRegistryStore,
  createPgAgentSessionOwnershipRegistryStore: hoisted.createPgAgentSessionOwnershipRegistryStore,
}));

vi.mock('./redisRegistryStores.js', () => ({
  createRedisWorkerCapabilityRegistryStore: hoisted.createRedisWorkerCapabilityRegistryStore,
  createRedisAgentSessionOwnershipRegistryStore:
    hoisted.createRedisAgentSessionOwnershipRegistryStore,
}));

import {
  createAgentSessionOwnershipRegistryStore,
  createWorkerCapabilityRegistryStore,
  getAgentSessionOwnershipRegistryStore,
  getWorkerCapabilityRegistryStore,
  resetRegistryStoreFactoryCaches,
} from './registryStoreFactory.js';

describe('registryStoreFactory', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetRegistryStoreFactoryCaches();
  });

  it('creates sqlite stores from the shared SQL client', async () => {
    const sqliteClient = { kind: 'sqlite' };
    hoisted.getJobRegistryDb.mockResolvedValue(sqliteClient);

    const workerStore = await createWorkerCapabilityRegistryStore({
      registryDriver: 'sqlite',
      registryPath: '/tmp/registry',
      registryNamespace: 'local',
    });
    const ownershipStore = await createAgentSessionOwnershipRegistryStore({
      registryDriver: 'sqlite',
      registryPath: '/tmp/registry',
      registryNamespace: 'local',
    });

    expect(hoisted.createSqliteWorkerCapabilityRegistryStore).toHaveBeenCalledWith(sqliteClient);
    expect(hoisted.createSqliteAgentSessionOwnershipRegistryStore).toHaveBeenCalledWith(
      sqliteClient,
    );
    expect(workerStore).toBe(hoisted.sqliteWorkerStore);
    expect(ownershipStore).toBe(hoisted.sqliteOwnershipStore);
  });

  it('creates pg stores from the shared SQL client', async () => {
    const pgClient = { kind: 'pg' };
    hoisted.getJobRegistryDb.mockResolvedValue(pgClient);

    const workerStore = await createWorkerCapabilityRegistryStore({
      registryDriver: 'pg',
      registryPgUrl: 'postgres://registry',
      registryNamespace: 'prod',
    });
    const ownershipStore = await createAgentSessionOwnershipRegistryStore({
      registryDriver: 'pg',
      registryPgUrl: 'postgres://registry',
      registryNamespace: 'prod',
    });

    expect(hoisted.createPgWorkerCapabilityRegistryStore).toHaveBeenCalledWith(pgClient);
    expect(hoisted.createPgAgentSessionOwnershipRegistryStore).toHaveBeenCalledWith(pgClient);
    expect(workerStore).toBe(hoisted.pgWorkerStore);
    expect(ownershipStore).toBe(hoisted.pgOwnershipStore);
  });

  it('creates and caches redis stores per process', async () => {
    const config = {
      registryDriver: 'redis' as const,
      registryRedisUrl: 'redis://registry',
      registryNamespace: 'prod',
    };

    const workerStoreA = await createWorkerCapabilityRegistryStore(config);
    const workerStoreB = await createWorkerCapabilityRegistryStore(config);
    const ownershipStoreA = await createAgentSessionOwnershipRegistryStore(config);
    const ownershipStoreB = await createAgentSessionOwnershipRegistryStore(config);

    expect(hoisted.createRedisWorkerCapabilityRegistryStore).toHaveBeenCalledTimes(1);
    expect(hoisted.createRedisWorkerCapabilityRegistryStore).toHaveBeenCalledWith(
      'redis://registry',
      { namespace: 'prod' },
    );
    expect(hoisted.createRedisAgentSessionOwnershipRegistryStore).toHaveBeenCalledTimes(1);
    expect(workerStoreA).toBe(workerStoreB);
    expect(ownershipStoreA).toBe(ownershipStoreB);
  });

  it('uses loaded core config in getter helpers', async () => {
    hoisted.loadCoreConfig.mockReturnValue({
      registryDriver: 'redis',
      registryRedisUrl: 'redis://registry',
      registryNamespace: 'prod',
    });

    await getWorkerCapabilityRegistryStore();
    await getAgentSessionOwnershipRegistryStore();

    expect(hoisted.loadCoreConfig).toHaveBeenCalledTimes(2);
    expect(hoisted.createRedisWorkerCapabilityRegistryStore).toHaveBeenCalledTimes(1);
    expect(hoisted.createRedisAgentSessionOwnershipRegistryStore).toHaveBeenCalledTimes(1);
  });

  it('rejects missing backend config', async () => {
    await expect(
      createWorkerCapabilityRegistryStore({
        registryDriver: 'sqlite',
        registryNamespace: 'local',
      }),
    ).rejects.toThrow('SNIPTAIL_REGISTRY_PATH');

    await expect(
      createWorkerCapabilityRegistryStore({
        registryDriver: 'pg',
        registryNamespace: 'prod',
      }),
    ).rejects.toThrow('SNIPTAIL_REGISTRY_PG_URL');

    await expect(
      createAgentSessionOwnershipRegistryStore({
        registryDriver: 'redis',
        registryNamespace: 'prod',
      }),
    ).rejects.toThrow('SNIPTAIL_REGISTRY_REDIS_URL');
  });
});
