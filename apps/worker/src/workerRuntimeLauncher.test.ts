import { beforeEach, describe, expect, it, vi } from 'vitest';

const hoisted = vi.hoisted(() => ({
  config: {
    repoAllowlist: {},
    jobWorkRoot: '/tmp/jobs',
    queueDriver: 'inproc',
    jobRegistryDriver: 'sqlite',
    jobRegistryPath: '/tmp/registry',
    botName: 'Sniptail',
    primaryAgent: 'codex',
    jobConcurrency: 2,
    bootstrapConcurrency: 2,
    workerEventConcurrency: 2,
    repoCacheRoot: '/tmp/repos',
    includeRawRequestInMr: false,
    copilot: {
      executionMode: 'local',
      idleRetries: 2,
    },
    codex: {
      executionMode: 'local',
    },
  },
  seedRepoCatalogFromAllowlistFile: vi.fn(),
  syncRunActionMetadata: vi.fn(),
  assertLocalAgentPreflight: vi.fn(() => Promise.resolve(undefined)),
}));

vi.mock('@sniptail/core/config/config.js', () => ({
  loadWorkerConfig: () => hoisted.config,
}));

vi.mock('@sniptail/core/repos/catalog.js', () => ({
  seedRepoCatalogFromAllowlistFile: hoisted.seedRepoCatalogFromAllowlistFile,
}));

vi.mock('./repos/syncRunActionMetadata.js', () => ({
  syncRunActionMetadata: hoisted.syncRunActionMetadata,
}));

vi.mock('./docker/dockerPreflight.js', () => ({
  assertDockerPreflight: vi.fn(() => Promise.resolve(undefined)),
}));

vi.mock('./preflight/agentPreflight.js', () => ({
  assertLocalAgentPreflight: hoisted.assertLocalAgentPreflight,
}));

vi.mock('./git/gitPreflight.js', () => ({
  assertGitCommitIdentityPreflight: vi.fn(() => Promise.resolve(undefined)),
}));

vi.mock('./job/createJobRegistry.js', () => ({
  createJobRegistry: vi.fn(() => ({
    loadJobRecord: vi.fn(),
    updateJobRecord: vi.fn(),
    loadAllJobRecords: vi.fn(),
    deleteJobRecords: vi.fn(),
    markJobForDeletion: vi.fn(),
    clearJobsBefore: vi.fn(),
    findLatestJobByChannelThread: vi.fn(),
    findLatestJobByChannelThreadAndTypes: vi.fn(),
  })),
}));

import { startWorkerRuntime } from './workerRuntimeLauncher.js';

describe('workerRuntimeLauncher', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hoisted.seedRepoCatalogFromAllowlistFile.mockResolvedValue({ seeded: 0, skipped: true });
    hoisted.syncRunActionMetadata.mockResolvedValue({
      scanned: 0,
      updated: 0,
      failures: [],
    });
    hoisted.assertLocalAgentPreflight.mockResolvedValue(undefined);
    hoisted.config.primaryAgent = 'codex';
  });

  it('fails fast when queue_driver=inproc without a shared runtime', async () => {
    await expect(startWorkerRuntime()).rejects.toThrow('sniptail local');
    expect(hoisted.assertLocalAgentPreflight).not.toHaveBeenCalled();
  });

  it('syncs run action metadata after repository seed on startup', async () => {
    const consumerClose = vi.fn(() => Promise.resolve(undefined));
    const queueRuntime = {
      consumeJobs: vi.fn(() => ({ close: consumerClose })),
      consumeBootstrap: vi.fn(() => ({ close: consumerClose })),
      consumeWorkerEvents: vi.fn(() => ({ close: consumerClose })),
      close: vi.fn(() => Promise.resolve(undefined)),
      queues: {
        botEvents: {
          add: vi.fn(() => Promise.resolve(undefined)),
        },
      },
    } as const;

    const runtime = await startWorkerRuntime({ queueRuntime: queueRuntime as never });
    await runtime.close();

    expect(hoisted.assertLocalAgentPreflight).toHaveBeenCalledTimes(1);
    expect(hoisted.assertLocalAgentPreflight).toHaveBeenCalledWith(hoisted.config, 'codex');
    expect(hoisted.seedRepoCatalogFromAllowlistFile).toHaveBeenCalledTimes(1);
    expect(hoisted.syncRunActionMetadata).toHaveBeenCalledTimes(1);
  });

  it('preflights only the configured primary agent', async () => {
    hoisted.config.primaryAgent = 'copilot';
    const consumerClose = vi.fn(() => Promise.resolve(undefined));
    const queueRuntime = {
      consumeJobs: vi.fn(() => ({ close: consumerClose })),
      consumeBootstrap: vi.fn(() => ({ close: consumerClose })),
      consumeWorkerEvents: vi.fn(() => ({ close: consumerClose })),
      close: vi.fn(() => Promise.resolve(undefined)),
      queues: {
        botEvents: {
          add: vi.fn(() => Promise.resolve(undefined)),
        },
      },
    } as const;

    const runtime = await startWorkerRuntime({ queueRuntime: queueRuntime as never });
    await runtime.close();

    expect(hoisted.assertLocalAgentPreflight).toHaveBeenCalledTimes(1);
    expect(hoisted.assertLocalAgentPreflight).toHaveBeenCalledWith(hoisted.config, 'copilot');
  });
});
