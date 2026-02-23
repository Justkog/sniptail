import { describe, expect, it, vi } from 'vitest';
import type { WorkerConfig } from '@sniptail/core/config/types.js';
import { assertLocalCodexPreflight } from './codexPreflight.js';

function buildConfig(): WorkerConfig {
  return {
    repoAllowlist: {},
    jobWorkRoot: '/tmp/jobs',
    queueDriver: 'redis',
    jobRegistryDriver: 'redis',
    jobRegistryRedisUrl: 'redis://localhost:6379/1',
    botName: 'Sniptail',
    redisUrl: 'redis://localhost:6379/0',
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
  };
}

describe('codex preflight', () => {
  it('checks codex when codex execution mode is local', async () => {
    const runExec = vi.fn().mockResolvedValue({ stdout: 'codex 0.79.0', stderr: '' });
    await assertLocalCodexPreflight(buildConfig(), runExec);
    expect(runExec).toHaveBeenCalledWith('codex', ['--version']);
  });

  it('skips check when codex execution mode is docker', async () => {
    const config = buildConfig();
    config.codex.executionMode = 'docker';
    const runExec = vi.fn();
    await assertLocalCodexPreflight(config, runExec);
    expect(runExec).not.toHaveBeenCalled();
  });

  it('fails fast with actionable guidance when codex is unavailable', async () => {
    const runExec = vi.fn().mockRejectedValue(
      Object.assign(new Error('failed to run codex'), {
        stderr: 'codex: command not found',
      }),
    );

    await expect(assertLocalCodexPreflight(buildConfig(), runExec)).rejects.toThrow(
      'Codex preflight failed',
    );
    await expect(assertLocalCodexPreflight(buildConfig(), runExec)).rejects.toThrow(
      '[codex].execution_mode="local"',
    );
    await expect(assertLocalCodexPreflight(buildConfig(), runExec)).rejects.toThrow(
      'npm install -g @openai/codex',
    );
    await expect(assertLocalCodexPreflight(buildConfig(), runExec)).rejects.toThrow(
      'codex --version',
    );
    await expect(assertLocalCodexPreflight(buildConfig(), runExec)).rejects.toThrow(
      'codex: command not found',
    );
  });
});
