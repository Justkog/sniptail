import { describe, expect, it, vi } from 'vitest';
import type { WorkerConfig } from '@sniptail/core/config/types.js';

const hoisted = vi.hoisted(() => ({
  launchAcpRuntime: vi.fn(),
  close: vi.fn(() => Promise.resolve()),
}));

vi.mock('@sniptail/core/acp/acpRuntime.js', () => ({
  launchAcpRuntime: hoisted.launchAcpRuntime,
}));

import { assertAcpPreflight } from './acpPreflight.js';

function buildConfig(): WorkerConfig {
  return {
    repoAllowlist: {},
    jobWorkRoot: '/tmp/jobs',
    queueDriver: 'redis',
    jobRegistryDriver: 'redis',
    jobRegistryRedisUrl: 'redis://localhost:6379/1',
    botName: 'Sniptail',
    redisUrl: 'redis://localhost:6379/0',
    primaryAgent: 'acp',
    jobConcurrency: 2,
    bootstrapConcurrency: 2,
    workerEventConcurrency: 2,
    repoCacheRoot: '/tmp/repos',
    includeRawRequestInMr: false,
    acp: {
      agent: 'opencode',
      command: ['opencode', 'acp'],
    },
    copilot: {
      executionMode: 'local',
      idleRetries: 2,
      idleTimeoutMs: 300_000,
    },
    codex: {
      executionMode: 'local',
    },
    opencode: {
      executionMode: 'local',
      startupTimeoutMs: 10_000,
      dockerStreamLogs: false,
    },
  };
}

describe('ACP preflight', () => {
  it('fails clearly when ACP is selected without an [acp] config', async () => {
    const config = buildConfig();
    config.acp = undefined;

    await expect(assertAcpPreflight(config)).rejects.toThrow(
      'ACP preflight failed: primary_agent="acp" requires an [acp] worker config with an ACP launch command or preset.',
    );
  });

  it('launches the ACP runtime against repoCacheRoot and closes it after initialize', async () => {
    hoisted.launchAcpRuntime.mockResolvedValue({
      close: hoisted.close,
    });

    await assertAcpPreflight(buildConfig());

    expect(hoisted.launchAcpRuntime).toHaveBeenCalledWith({
      launch: {
        agent: 'opencode',
        command: ['opencode', 'acp'],
      },
      cwd: '/tmp/repos',
      diagnostics: {
        configSource: '[acp]',
      },
    });
    expect(hoisted.close).toHaveBeenCalledTimes(1);
  });

  it('wraps ACP launch failures with preflight guidance', async () => {
    hoisted.launchAcpRuntime.mockRejectedValue(
      new Error(
        'ACP runtime failed ([acp], command: opencode, configured agent: opencode): Invalid params',
      ),
    );

    await expect(assertAcpPreflight(buildConfig())).rejects.toThrow(
      'ACP preflight failed: local stdio ACP launch did not reach initialize.',
    );
    await expect(assertAcpPreflight(buildConfig())).rejects.toThrow('[acp]');
    await expect(assertAcpPreflight(buildConfig())).rejects.toThrow('command: opencode');
  });
});
