import { describe, expect, it, vi } from 'vitest';
import type { WorkerConfig } from '@sniptail/core/config/types.js';

const hoisted = vi.hoisted(() => ({
  assertOpenCodeServerReachable: vi.fn(),
}));

vi.mock('@sniptail/core/opencode/health.js', () => ({
  assertOpenCodeServerReachable: hoisted.assertOpenCodeServerReachable,
}));

import { assertOpenCodePreflight } from './opencodePreflight.js';

function buildConfig(): WorkerConfig {
  return {
    repoAllowlist: {},
    jobWorkRoot: '/tmp/jobs',
    queueDriver: 'redis',
    jobRegistryDriver: 'redis',
    jobRegistryRedisUrl: 'redis://localhost:6379/1',
    botName: 'Sniptail',
    redisUrl: 'redis://localhost:6379/0',
    primaryAgent: 'opencode',
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
    opencode: {
      executionMode: 'local',
      startupTimeoutMs: 10_000,
      dockerStreamLogs: false,
    },
  };
}

describe('opencode preflight', () => {
  it('checks opencode CLI when execution mode is local', async () => {
    const runExec = vi.fn().mockResolvedValue({ stdout: 'opencode 1.2.3', stderr: '' });
    await assertOpenCodePreflight(buildConfig(), runExec);
    expect(runExec).toHaveBeenCalledWith('opencode', ['--version']);
  });

  it('skips check when execution mode is docker', async () => {
    const config = buildConfig();
    config.opencode.executionMode = 'docker';
    const runExec = vi.fn();
    await assertOpenCodePreflight(config, runExec);
    expect(runExec).not.toHaveBeenCalled();
  });

  it('checks configured server when execution mode is server', async () => {
    const config = buildConfig();
    config.opencode.executionMode = 'server';
    config.opencode.serverUrl = 'http://127.0.0.1:4096';
    config.opencode.serverAuthHeaderEnv = 'OPENCODE_AUTH_HEADER';
    process.env.OPENCODE_AUTH_HEADER = 'Bearer secret';
    hoisted.assertOpenCodeServerReachable.mockResolvedValue(undefined);

    await assertOpenCodePreflight(config, vi.fn());

    expect(hoisted.assertOpenCodeServerReachable).toHaveBeenCalledWith('http://127.0.0.1:4096', {
      Authorization: 'Bearer secret',
    });
  });

  it('fails fast with actionable guidance when opencode is unavailable', async () => {
    const runExec = vi.fn().mockRejectedValue(
      Object.assign(new Error('failed to run opencode'), {
        stderr: 'opencode: command not found',
      }),
    );

    await expect(assertOpenCodePreflight(buildConfig(), runExec)).rejects.toThrow(
      'OpenCode preflight failed',
    );
    await expect(assertOpenCodePreflight(buildConfig(), runExec)).rejects.toThrow(
      '[opencode].execution_mode="local"',
    );
    await expect(assertOpenCodePreflight(buildConfig(), runExec)).rejects.toThrow(
      'npm install -g opencode-ai',
    );
    await expect(assertOpenCodePreflight(buildConfig(), runExec)).rejects.toThrow(
      'opencode --version',
    );
  });
});
