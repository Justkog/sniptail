import { describe, expect, it, vi } from 'vitest';

vi.mock('@sniptail/core/config/config.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@sniptail/core/config/config.js')>();
  return {
    ...actual,
    loadWorkerConfig: () => ({
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
    }),
  };
});

import { startWorkerRuntime } from './workerRuntimeLauncher.js';

describe('workerRuntimeLauncher', () => {
  it('fails fast when queue_driver=inproc without a shared runtime', async () => {
    await expect(startWorkerRuntime()).rejects.toThrow('sniptail local');
  });
});
